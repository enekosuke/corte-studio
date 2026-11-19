import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { getBrand, subtitlePresets } from '../pipeline/brands.mjs';
import { RequestError } from '../pipeline/errors.mjs';
import { formatCatalog, normalizeFormat } from '../pipeline/formats.mjs';
import { renameWithRetry } from '../pipeline/fsx.mjs';
import { getClipFile, getJob, getSourceFile, getTranscript, jobsDir, saveJobRecord, startJob } from '../pipeline/jobs.mjs';
import { probeVideo, renderClip } from '../pipeline/media.mjs';
import { buildClipPartsForExport, generateEdl, generateFcpxml } from '../pipeline/export-nle.mjs';
import { generateClipThumbnail, thumbnailNameForClip, thumbnailPathForClip } from '../pipeline/thumbnails.mjs';
import { assertLocalMutation, readJsonBody } from './context.mjs';

const clipEditPath = /^\/api\/jobs\/([a-f0-9-]+)\/clips\/(clip-\d+\.mp4)(\/rerender|\/thumbnail|\/export-edl)?$/;
const allowedVideoExt = new Set(['.mp4', '.mkv', '.mov', '.webm']);
const maxUploadBytes = 8 * 1024 * 1024 * 1024; // 8 GB local OBS recording

function sanitizeEdits(input = {}, clip = {}) {
  const edits = { ...(clip.edits ?? {}) };
  if (input.trimStart !== undefined) {
    const v = Number(input.trimStart);
    if (!Number.isFinite(v) || v < 0) throw new RequestError(400, 'trimStart debe ser un número válido >= 0.');
    edits.trimStart = Number(v.toFixed(3));
  }
  if (input.trimEnd !== undefined) {
    const v = Number(input.trimEnd);
    if (!Number.isFinite(v) || v <= 0) throw new RequestError(400, 'trimEnd debe ser un número válido > 0.');
    edits.trimEnd = Number(v.toFixed(3));
  }
  const start = edits.trimStart ?? clip.start;
  const end = edits.trimEnd ?? clip.end;
  if (end - start < 3 || end - start > 180) {
    throw new RequestError(400, 'La duración del clip editado debe estar entre 3 y 180 segundos.');
  }
  if (input.onScreenHook !== undefined) {
    edits.onScreenHook = String(input.onScreenHook ?? '').replace(/\s+/g, ' ').trim().slice(0, 72);
  }
  if (input.subtitlePreset !== undefined) {
    if (!subtitlePresets.includes(input.subtitlePreset)) {
      throw new RequestError(400, `Preset de subtítulos inválido. Usa uno de: ${subtitlePresets.join(', ')}.`);
    }
    edits.subtitlePreset = input.subtitlePreset;
  }
  if (input.layoutOverride !== undefined) {
    if (input.layoutOverride && !formatCatalog.layouts.includes(input.layoutOverride)) {
      throw new RequestError(400, 'Layout no válido.');
    }
    edits.layoutOverride = input.layoutOverride || undefined;
  }
  if (input.removeSilences !== undefined) edits.removeSilences = Boolean(input.removeSilences);
  if (input.brandId !== undefined) edits.brandId = String(input.brandId ?? '').trim() || undefined;
  if (Array.isArray(input.wordOverrides)) {
    edits.wordOverrides = input.wordOverrides
      .filter((entry) => entry && Number.isInteger(entry.index) && typeof entry.text === 'string')
      .slice(0, 200)
      .map(({ index, text }) => ({ index, text: text.trim().slice(0, 60) }));
  }
  edits.updatedAt = new Date().toISOString();
  return edits;
}

function applyWordOverrides(transcript, clipStart, clipEnd, overrides = []) {
  if (!overrides.length || !transcript?.segments) return transcript;
  const clone = structuredClone(transcript);
  const byIdx = new Map(overrides.map(({ index, text }) => [index, text]));
  let cursor = 0;
  for (const seg of clone.segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    if (Array.isArray(seg.words) && seg.words.length) {
      for (const word of seg.words) {
        if (word.end <= clipStart || word.start >= clipEnd) continue;
        if (byIdx.has(cursor) && byIdx.get(cursor)) word.text = byIdx.get(cursor);
        cursor++;
      }
      seg.text = seg.words.map((w) => w.text).join(' ');
    }
  }
  return clone;
}

/**
 * Rutas NLE:
 * - PATCH /api/jobs/:id/clips/:file           (guarda ediciones no destructivas)
 * - POST  /api/jobs/:id/clips/:file/rerender  (re-renderiza solo ese clip en segundos)
 * - POST  /api/jobs/upload                    (ingesta de archivo local MP4/MKV/MOV/WEBM)
 */
export async function handleNleRoute({ request, response, pathname, searchParams, origin, sendJson, resolveEngine }) {
  if (pathname === '/api/jobs/upload' && request.method === 'POST') {
    assertLocalMutation(request, origin);
    const rawName = decodeURIComponent(String(request.headers['x-file-name'] ?? 'video.mp4')).trim();
    const ext = extname(rawName).toLowerCase();
    if (!allowedVideoExt.has(ext)) {
      throw new RequestError(400, 'Formato no admitido. Sube un archivo .mp4, .mkv, .mov o .webm.');
    }
    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (contentLength > maxUploadBytes) throw new RequestError(413, 'El archivo supera el límite de 8 GB.');

    const id = randomUUID();
    const dir = join(jobsDir, id);
    await mkdir(dir, { recursive: true });
    const targetPath = join(dir, `source${ext}`);
    try {
      let received = 0;
      request.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxUploadBytes) request.destroy(new RequestError(413, 'El archivo supera el límite de 8 GB.'));
      });
      await streamPipeline(request, createWriteStream(targetPath));
      if (received < 1024) throw new RequestError(400, 'El archivo de vídeo está vacío.');
      await probeVideo(targetPath);
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error instanceof RequestError ? error : new RequestError(400, 'El archivo subido no es un vídeo válido.');
    }

    const provider = String(request.headers['x-provider'] ?? 'gemini');
    const modelId = request.headers['x-model'] ? String(request.headers['x-model']) : undefined;
    const mode = ['normal', 'prototype', 'summary'].includes(request.headers['x-mode']) ? String(request.headers['x-mode']) : 'normal';
    const voice = request.headers['x-voice'] ? String(request.headers['x-voice']) : undefined;
    let format;
    if (request.headers['x-format']) {
      try { format = normalizeFormat(JSON.parse(String(request.headers['x-format']))); } catch { format = undefined; }
    }
    const engine = await resolveEngine(provider, modelId);
    const baseTitle = rawName.replace(/\.[^.]+$/, '').slice(0, 90) || 'Vídeo local';
    const source = {
      platform: 'local',
      kind: 'file',
      videoId: `local-${id.slice(0, 8)}`,
      url: `local://${id}/${rawName}`,
      label: baseTitle,
      localPath: targetPath,
      title: baseTitle,
    };
    const job = await startJob(source, engine, undefined, format, { mode, voice, preloadedDir: id, preloadedSource: targetPath });
    sendJson(response, 202, job);
    return true;
  }

  const match = clipEditPath.exec(pathname);
  if (!match) return false;
  const [, id, file, rerender] = match;

  if (!rerender && request.method === 'PATCH') {
    const body = await readJsonBody(request, origin, 16_384);
    const job = await getJob(id);
    if (!job) throw new RequestError(404, 'Proyecto no encontrado.');
    const clip = (job.clips ?? []).find((c) => c.file === file);
    if (!clip) throw new RequestError(404, 'Clip no encontrado.');
    clip.edits = sanitizeEdits(body, clip);
    await saveJobRecord(job);
    sendJson(response, 200, { ok: true, file, edits: clip.edits });
    return true;
  }

  if (rerender === '/export-edl' && request.method === 'GET') {
    const job = await getJob(id);
    if (!job) throw new RequestError(404, 'Proyecto no encontrado.');
    const clip = (job.clips ?? []).find((c) => c.file === file);
    if (!clip) throw new RequestError(404, 'Clip no encontrado.');
    const transcript = await getTranscript(id).catch(() => null);
    const fmt = (searchParams?.get('format') || 'edl').toLowerCase();
    const parts = buildClipPartsForExport(clip, transcript, { removeSilences: clip.edits?.removeSilences === true });
    const title = clip.title || file;
    const isXml = fmt === 'fcpxml';
    const content = isXml
      ? generateFcpxml({ title, sourceName: 'source.mp4', parts })
      : generateEdl({ title, sourceName: 'source.mp4', parts });
    const ext = isXml ? 'fcpxml' : 'edl';
    const baseName = file.replace(/\.mp4$/i, `.${ext}`);
    const buf = Buffer.from(content, 'utf8');
    response.writeHead(200, {
      'Content-Type': isXml ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${baseName}"`,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    response.end(buf);
    return true;
  }

  if (rerender === '/thumbnail' && request.method === 'POST') {
    const body = await readJsonBody(request, origin, 4096).catch(() => ({}));
    const job = await getJob(id);
    if (!job) throw new RequestError(404, 'Proyecto no encontrado.');
    const clip = (job.clips ?? []).find((c) => c.file === file);
    if (!clip) throw new RequestError(404, 'Clip no encontrado.');
    const clipPath = await getClipFile(id, file);
    if (!clipPath) throw new RequestError(404, 'Archivo de clip no disponible.');
    const brand = await getBrand(clip.edits?.brandId || job.brandId);
    const outPath = thumbnailPathForClip(dirname(clipPath), file);
    const thumbName = thumbnailNameForClip(file);
    const coverText = body.coverText !== undefined ? String(body.coverText) : (clip.edits?.onScreenHook || clip.onScreenHook || clip.title || '');
    const res = await generateClipThumbnail(clipPath, outPath, {
      timestamp: body.timestamp ?? 1.2,
      coverText,
      accentHex: body.accentHex || brand.accentHex || '#FFE600',
    });
    clip.thumbnailFile = thumbName;
    await saveJobRecord(job);
    sendJson(response, 200, { ok: true, file: thumbName, url: `/media/${id}/${thumbName}?t=${Date.now()}`, ...res });
    return true;
  }

  if (rerender === '/rerender' && request.method === 'POST') {
    const body = await readJsonBody(request, origin, 16_384).catch(() => ({}));
    const job = await getJob(id);
    if (!job) throw new RequestError(404, 'Proyecto no encontrado.');
    const clip = (job.clips ?? []).find((c) => c.file === file);
    if (!clip) throw new RequestError(404, 'Clip no encontrado.');
    const sourcePath = await getSourceFile(id);
    if (!sourcePath) throw new RequestError(409, 'El vídeo fuente fue eliminado; no se puede re-renderizar este clip.');
    const clipPath = await getClipFile(id, file);
    if (!clipPath) throw new RequestError(404, 'Archivo de clip no disponible.');
    const transcriptRaw = await getTranscript(id);
    if (!transcriptRaw) throw new RequestError(409, 'Falta la transcripción del proyecto.');

    if (body && Object.keys(body).length) {
      clip.edits = sanitizeEdits(body, clip);
    }
    const edits = clip.edits ?? {};
    const effectiveStart = edits.trimStart ?? clip.start;
    const effectiveEnd = edits.trimEnd ?? clip.end;
    const effectiveClip = {
      ...clip,
      start: effectiveStart,
      end: effectiveEnd,
      onScreenHook: edits.onScreenHook !== undefined ? edits.onScreenHook : clip.onScreenHook,
    };
    const transcript = applyWordOverrides(transcriptRaw, effectiveStart, effectiveEnd, edits.wordOverrides);
    const brandBase = await getBrand(edits.brandId || job.brandId);
    const brand = {
      ...brandBase,
      ...(edits.subtitlePreset ? { subtitlePreset: edits.subtitlePreset } : {}),
    };
    const plan = {
      ...(clip.framing ?? { layout: 'fill', points: [{ offset: 0, center: 0.5 }] }),
      ...(edits.layoutOverride ? { layout: edits.layoutOverride } : {}),
    };
    const format = normalizeFormat(job.format);
    const directory = dirname(clipPath);
    const clipNum = Number(/^clip-(\d+)\.mp4$/.exec(file)?.[1] ?? 1);
    const media = await probeVideo(sourcePath);

    await renderClip(sourcePath, directory, effectiveClip, transcript, plan, clipNum, format, {
      aspect: media.aspect,
      brand,
      removeSilences: edits.removeSilences,
    });

    clip.start = effectiveStart;
    clip.end = effectiveEnd;
    if (edits.onScreenHook !== undefined) clip.onScreenHook = edits.onScreenHook;
    clip.edits = { ...edits, revision: (edits.revision ?? 0) + 1, rerenderedAt: new Date().toISOString() };
    await saveJobRecord(job);
    sendJson(response, 200, {
      ok: true,
      file,
      revision: clip.edits.revision,
      url: `/media/${id}/${file}?v=${clip.edits.revision}`,
      clip,
    });
    return true;
  }

  throw new RequestError(405, 'Método no disponible.');
}
