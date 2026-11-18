import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import youtube from '../dist/youtube.js';
import { RequestError } from './errors.mjs';
import { compositionGraph, containOffsetY, defaultFormat, layoutPanels, outputSize } from './formats.mjs';

export const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));
const speechScript = fileURLToPath(new URL('./transcribe.py', import.meta.url));
const webcamScript = fileURLToPath(new URL('./webcam.py', import.meta.url));
const twitchScript = fileURLToPath(new URL('./twitch_snapshot.py', import.meta.url));
const youtubeLiveScript = fileURLToPath(new URL('./youtube_live.py', import.meta.url));
const voiceoverScript = fileURLToPath(new URL('./voiceover.py', import.meta.url));
const ttsModelsDir = join(dataDir, 'tts-models');
const mediaProbe = fileURLToPath(new URL('../dist/assets/podcast.png', import.meta.url));
const watermark = fileURLToPath(new URL('../dist/assets/watermark.png', import.meta.url));
export const youtubeHandle = '@RisaWOW';
const python = process.env.CORTE_PYTHON || 'python';
const windowsSuffix = process.platform === 'win32' ? '.exe' : '';
const toolEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^CORTE_(GEMINI_API_KEY(?:_[12])?|OPENROUTER_API_KEY|LM_STUDIO_TOKEN)$/i.test(name)));
const activeChildren = new Set();
let mediaTools;

export function cancelError() {
  return new RequestError(499, 'Análisis cancelado por el usuario.', 'CANCELLED');
}

export function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  }
  try { child.kill('SIGKILL'); } catch { /* Process already exited. */ }
}

export function abortMediaProcesses() {
  for (const child of activeChildren) killProcessTree(child);
}

async function run(command, args, { cwd, timeout = 20 * 60_000, env = toolEnv, signal, onStdoutLine } = {}) {
  if (signal?.aborted) throw cancelError();
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(processHandle);
    let stdout = '';
    let stderr = '';
    let lineCarry = '';
    let timedOut = false;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      killProcessTree(processHandle);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(processHandle);
    }, timeout);
    processHandle.stdout.setEncoding('utf8');
    processHandle.stderr.setEncoding('utf8');
    processHandle.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-2_000_000);
      if (onStdoutLine) {
        const combined = lineCarry + chunk;
        const parts = combined.split(/\r?\n|\r/);
        lineCarry = parts.pop() ?? '';
        for (const line of parts) {
          if (line.trim()) {
            try { onStdoutLine(line); } catch { /* Ignore progress callback error. */ }
          }
        }
      }
    });
    processHandle.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-200_000); });
    processHandle.on('error', (error) => {
      activeChildren.delete(processHandle);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      reject(aborted ? cancelError() : error);
    });
    processHandle.on('close', (code) => {
      activeChildren.delete(processHandle);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (aborted) reject(cancelError());
      else if (code === 0 && !timedOut) resolve({ stdout, stderr });
      else {
        const error = new Error(timedOut ? 'Tiempo de espera agotado.' : stderr.trim() || `Proceso finalizado con código ${code}.`);
        error.stdout = stdout;
        reject(error);
      }
    });
  });
}

function pythonEnvironment() {
  return {
    ...toolEnv,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONPATH: [join(dataDir, 'python-tools'), toolEnv.PYTHONPATH].filter(Boolean).join(delimiter),
  };
}

async function probeFfmpegGpu(ffmpeg) {
  if (process.env.CORTE_FFMPEG_GPU === '0') return { cuda: false, nvenc: false };
  const hwaccels = await run(ffmpeg, ['-hide_banner', '-hwaccels'], { timeout: 4_000 }).catch(() => ({ stdout: '' }));
  const cuda = /\bcuda\b/.test(hwaccels.stdout);
  const nvenc = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.04', '-c:v', 'h264_nvenc', '-f', 'null', '-',
  ], { timeout: 6_000 }).then(() => true, () => false);
  return { cuda, nvenc };
}

async function runFfmpeg(ffmpeg, cuda, buildArgs, options) {
  if (!cuda) return run(ffmpeg, buildArgs(false), options);
  try {
    return await run(ffmpeg, buildArgs(true), options);
  } catch (error) {
    if (error.code === 'CANCELLED' || !/hwaccel|cuda|cuvid|nvdec|device|decoder/i.test(error.message)) throw error;
    return run(ffmpeg, buildArgs(false), options);
  }
}

async function findMediaTools() {
  const directories = process.env.CORTE_FFMPEG_DIR ? [process.env.CORTE_FFMPEG_DIR] : (process.env.PATH ?? '').split(delimiter);
  for (const entry of new Set(directories.filter(Boolean))) {
    const directory = entry.replace(/^"|"$/g, '');
    const ffmpeg = join(directory, `ffmpeg${windowsSuffix}`);
    const ffprobe = join(directory, `ffprobe${windowsSuffix}`);
    try {
      await Promise.all([stat(ffmpeg), stat(ffprobe)]);
      const [filters, codecs, probe] = await Promise.all([
        run(ffmpeg, ['-hide_banner', '-filters'], { timeout: 4_000 }),
        run(ffmpeg, ['-hide_banner', '-codecs'], { timeout: 4_000 }),
        run(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', mediaProbe], { timeout: 4_000 }),
      ]);
      const image = JSON.parse(probe.stdout).streams?.[0];
      if (!/\bass\s+V->V\b/.test(filters.stdout) || !/\bdrawtext\s+V->V\b/.test(filters.stdout) || !/\blibx264\b/.test(codecs.stdout) || !/\bav1\b/.test(codecs.stdout) || !image?.width || !image.height) continue;
      return { ffmpeg, ffprobe, ...await probeFfmpegGpu(ffmpeg) };
    } catch {
      // Continue past entries that have only Python launchers or inactive links.
    }
  }
  throw new RequestError(503, 'No se encontró un par FFmpeg y FFprobe con ASS, H.264 y AV1. Indica su carpeta en CORTE_FFMPEG_DIR y reinicia el estudio.');
}

export function getMediaTools() {
  mediaTools ??= findMediaTools().catch((error) => {
    mediaTools = undefined;
    throw error;
  });
  return mediaTools;
}

async function inspectStreams(path) {
  const { ffprobe } = await getMediaTools();
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { timeout: 30_000 });
  return JSON.parse(stdout);
}

async function joinDownloadedTracks(directory) {
  const files = (await readdir(directory)).filter((name) => /^source\.f[\w-]+\.(mp4|m4a|webm|mkv)$/i.test(name));
  let video;
  let audio;
  for (const name of files) {
    const path = join(directory, name);
    const streams = (await inspectStreams(path).catch(() => null))?.streams ?? [];
    if (streams.some((stream) => stream.codec_type === 'video' && stream.width)) video ??= path;
    if (streams.some((stream) => stream.codec_type === 'audio')) audio ??= path;
  }
  if (!video || !audio) return null;

  const { ffmpeg } = await getMediaTools();
  const partial = join(directory, 'source-join.partial.mkv');
  const output = join(directory, 'source.mkv');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', partial], { cwd: directory, timeout: 10 * 60_000 });
  await probeVideo(partial);
  await rename(partial, output);
  return output;
}

/**
 * Resolve Twitch channels (live streams from start), VODs, or clips into a
 * finite downloadable target, freezing active live HLS EVENT manifests so they
 * capture from t=0 up to the current moment without hanging.
 */
async function resolveTwitchDownload(sourceUrl, directory, signal) {
  let rawStdout = '';
  try {
    const res = await run(python, [twitchScript, sourceUrl, directory], {
      cwd: directory, env: pythonEnvironment(), timeout: 60_000, signal,
    });
    rawStdout = res.stdout;
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    rawStdout = error.stdout ?? '';
    if (!rawStdout) throw new RequestError(502, `No se pudo inspeccionar Twitch: ${error.message}`);
  }
  let info;
  try {
    info = JSON.parse(rawStdout.trim().split(/\r?\n/).at(-1));
  } catch {
    throw new RequestError(502, 'Respuesta inválida al resolver el vídeo o directo de Twitch.');
  }
  if (!info?.ok) {
    const vodHint = info?.latestVods?.[0]?.url ? ` Puedes usar su último VOD publicado: ${info.latestVods[0].url}` : '';
    if (info?.code === 'OFFLINE') {
      throw new RequestError(422, `El canal "${info.channel}" no está en directo ahora mismo.${vodHint}`);
    }
    if (info?.code === 'LIVE_VOD_UNAVAILABLE') {
      throw new RequestError(422, `El canal "${info.channel}" está en directo, pero Twitch oculta el VOD en vivo (archiveVideo no disponible mientras emite), así que no expone el tramo desde 00:00 hasta ahora mientras dura el directo.${vodHint}`);
    }
    throw new RequestError(422, info?.message || 'Twitch no ofreció un stream o VOD descargable.');
  }
  return info;
}

/**
 * Download an active YouTube live stream from 00:00 (or earliest DVR segment)
 * up to the exact current live head sequence without tailing indefinitely.
 */
async function downloadYouTubeLiveFromStart(sourceUrl, directory, ffmpeg, { signal, onStdoutLine, maxFragments = 0 } = {}) {
  const args = ['-u', youtubeLiveScript, sourceUrl, directory, dirname(ffmpeg)];
  if (maxFragments > 0) args.push('--max-fragments', String(maxFragments));
  let res;
  try {
    res = await run(python, args, {
      cwd: directory,
      env: pythonEnvironment(),
      timeout: 120 * 60_000,
      signal,
      onStdoutLine,
    });
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    const lastLine = (error.stdout ?? '').trim().split(/\r?\n/).at(-1) || '';
    try {
      const errJson = JSON.parse(lastLine);
      if (errJson?.message) throw new RequestError(422, errJson.message);
    } catch (parseErr) {
      if (parseErr instanceof RequestError) throw parseErr;
    }
    throw new RequestError(502, `La captura del directo de YouTube falló. ${error.message.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 220) ?? ''}`.trim());
  }
  const metaLine = (res.stdout ?? '').split(/\r?\n|\r/).map((l) => l.trim()).find((l) => l.startsWith('CORTE_LIVE_META:'));
  if (!metaLine) throw new RequestError(502, 'La captura del directo de YouTube no devolvió metadatos válidos.');
  return JSON.parse(metaLine.slice('CORTE_LIVE_META:'.length));
}

export async function downloadVideo(sourceOrId, directory, { signal, onProgress, maxFragments = 0 } = {}) {
  const { ffmpeg } = await getMediaTools();
  const source = youtube.sourceFromJob(sourceOrId);
  const isTwitch = source.platform === 'twitch';
  let resolvedTwitch = null;
  let targetUrl = source.url || `https://www.youtube.com/watch?v=${sourceOrId}`;

  if (isTwitch) {
    resolvedTwitch = await resolveTwitchDownload(targetUrl, directory, signal);
    targetUrl = resolvedTwitch.downloadUrl;
  }

  let result;
  let recovered;
  let lastProgressAt = 0;
  const handleStdout = onProgress ? (line) => {
    const clean = line.trim();
    const prefix = clean.startsWith('CORTE_DL:') ? 'CORTE_DL:' : (clean.startsWith('download:') ? 'download:' : null);
    if (!prefix) return;
    const now = Date.now();
    if (now - lastProgressAt < 350) return;
    const [pctRaw = '', speedRaw = '', dlRaw = '', etaRaw = ''] = clean.slice(prefix.length).split('|');
    const percent = Math.max(0, Math.min(99, Math.round(Number.parseFloat(pctRaw) || 0)));
    lastProgressAt = now;
    onProgress({
      percent,
      speed: speedRaw.trim() || '—',
      downloaded: dlRaw.trim() || '—',
      eta: etaRaw.trim() || '—',
    });
  } : undefined;

  const isLocalSnapshot = targetUrl.startsWith('file://');
  let ytLiveMeta = null;

  if (!isTwitch && source.kind === 'live') {
    ytLiveMeta = await downloadYouTubeLiveFromStart(targetUrl, directory, ffmpeg, { signal, onStdoutLine: handleStdout, maxFragments });
  } else {
    const dlArgs = [
      '-u', '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-simulate', '--no-warnings',
      '--no-write-subs', '--no-write-auto-subs', '--no-embed-metadata', '--no-embed-thumbnail',
      '--continue', '--concurrent-fragments', '8', '--buffer-size', '256K',
      '--newline', '--progress', '--progress-template', 'download:CORTE_DL:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._downloaded_bytes_str)s|%(progress._eta_str)s',
      '--ffmpeg-location', dirname(ffmpeg),
      '--socket-timeout', '25', '--retries', '8', '--fragment-retries', '8',
      ...(isLocalSnapshot ? ['--enable-file-urls'] : []),
      ...(!isTwitch ? ['--js-runtimes', `node:${process.execPath}`, '--match-filter', '!is_live'] : []),
      ...(!isLocalSnapshot ? ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b'] : []),
      '--merge-output-format', 'mkv',
      '-o', 'source.%(ext)s',
      '--print', 'before_dl:CORTE_TITLE:%(title)j',
      '--', targetUrl,
    ];

    try {
      result = await run(python, dlArgs, { cwd: directory, env: pythonEnvironment(), timeout: 90 * 60_000, signal, onStdoutLine: handleStdout });
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      if (/Postprocessing|Merger/i.test(error.message)) {
        recovered = await joinDownloadedTracks(directory).catch(() => null);
        if (recovered) result = { stdout: error.stdout ?? '' };
      }
      if (!recovered) {
        if (/No module named yt_dlp/i.test(error.message)) throw new RequestError(503, 'Falta yt-dlp en el entorno de Python. Consulta el README para instalarlo.');
        if (/sign in|login|age.?restrict|private|not a bot|unavailable|no formats|unblock|subscriber/i.test(error.message)) {
          throw new RequestError(422, `${isTwitch ? 'Twitch' : 'YouTube'} no ofreció un archivo descargable para este enlace. Comprueba que sea público.`);
        }
        const detail = error.message.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 230) ?? '';
        throw new RequestError(502, `La importación de ${isTwitch ? 'Twitch' : 'YouTube'} falló. ${detail}`.trim());
      }
    } finally {
      if (resolvedTwitch?.snapshotPath) {
        await rm(resolvedTwitch.snapshotPath, { force: true }).catch(() => {});
      }
    }

    const combinedLog = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
    const hasFile = (await readdir(directory)).some((name) => /^source\.(mkv|mp4|webm|m4v|mov|avi|flv|3gp|ts)$/i.test(name));
    if (!isTwitch && (!hasFile || /does not pass filter \(!is_live\)/i.test(combinedLog))) {
      ytLiveMeta = await downloadYouTubeLiveFromStart(targetUrl, directory, ffmpeg, { signal, onStdoutLine: handleStdout, maxFragments });
    }
  }
  const filename = (await readdir(directory)).find((name) => /^source\.(mkv|mp4|webm|m4v|mov|avi|flv|3gp|ts)$/i.test(name));
  if (!filename) throw new RequestError(502, 'La descarga no produjo un archivo de vídeo. Comprueba que el directo haya terminado o tenga VOD disponible.');
  let title = ytLiveMeta?.title || resolvedTwitch?.title || (isTwitch ? 'Vídeo de Twitch' : 'Vídeo de YouTube');
  if (!ytLiveMeta && (!isLocalSnapshot || !resolvedTwitch?.title)) {
    try {
      const titleLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('CORTE_TITLE:'));
      const rawJson = titleLine ? titleLine.slice('CORTE_TITLE:'.length).trim() : result.stdout.trim().split(/\r?\n/).at(-1);
      const printedTitle = JSON.parse(rawJson);
      if (typeof printedTitle === 'string' && printedTitle.trim() && printedTitle !== 'live-snapshot') {
        title = printedTitle.trim().slice(0, 200);
      }
    } catch {
      // The source remains usable without its display title.
    }
  }
  return {
    path: recovered ?? join(directory, filename),
    title,
    isLiveSnapshot: Boolean(ytLiveMeta?.isLive || resolvedTwitch?.isLive),
    elapsedSeconds: ytLiveMeta?.elapsedSeconds ?? resolvedTwitch?.elapsedSeconds,
  };
}

export async function probeVideo(source) {
  const metadata = await inspectStreams(source);
  const video = metadata.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const duration = Number(metadata.format?.duration ?? video?.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new RequestError(422, 'El origen no contiene un vídeo con duración válida.');
  const rotation = Number(video.side_data_list?.find((entry) => Number.isFinite(entry.rotation))?.rotation ?? video.tags?.rotate ?? 0);
  const [sarWidth, sarHeight] = (video.sample_aspect_ratio ?? '1:1').split(':').map(Number);
  const sar = sarWidth > 0 && sarHeight > 0 ? sarWidth / sarHeight : 1;
  const rotated = Math.abs(rotation % 180) > 45;
  const aspect = rotated ? video.height / (video.width * sar) : (video.width * sar) / video.height;
  return { duration, aspect, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, audio: metadata.streams.some((stream) => stream.codec_type === 'audio') };
}

export async function transcribeVideo(source, directory, { signal } = {}) {
  const output = join(directory, 'transcript.json');
  const cache = join(dataDir, 'models');
  await mkdir(cache, { recursive: true });
  try {
    await run(python, [speechScript, source, output, '--cache', cache, '--model', process.env.CORTE_WHISPER_MODEL || 'large-v3-turbo'], {
      cwd: directory, env: pythonEnvironment(), timeout: 4 * 60 * 60_000, signal,
    });
    return JSON.parse(await readFile(output, 'utf8'));
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    if (/No module named.*faster_whisper/i.test(error.message)) throw new RequestError(503, 'Falta faster-whisper en el entorno de Python. Consulta el README para instalarlo.');
    if (/huggingface|snapshot|connection|download/i.test(error.message)) throw new RequestError(502, 'No se pudo preparar el modelo local de Whisper. Comprueba la conexión para la primera descarga.');
    throw new RequestError(502, `Whisper no pudo transcribir el audio. ${error.message.split(/\r?\n/).at(-1)?.slice(0, 160) ?? ''}`.trim());
  }
}

const decimal = (seconds) => seconds.toFixed(3);

function computeAudioFrames(ffmpeg, source, signal) {
  if (signal?.aborted) return Promise.reject(cancelError());
  return new Promise((resolve, reject) => {
    const sampleRate = 8000;
    const frameSamples = 1600; // 200ms RMS frames
    const frameBytes = frameSamples * 2;
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', source,
      '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1',
    ], { env: toolEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    activeChildren.add(child);
    const frames = [];
    let carry = Buffer.alloc(0);
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      killProcessTree(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { killProcessTree(child); resolve(frames); }, 3 * 60_000);
    child.stdout.on('data', (chunk) => {
      const buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      let offset = 0;
      while (offset + frameBytes <= buffer.length) {
        let sum = 0;
        for (let pos = offset; pos < offset + frameBytes; pos += 2) {
          const sample = buffer.readInt16LE(pos);
          sum += sample * sample;
        }
        frames.push(Math.sqrt(sum / frameSamples));
        offset += frameBytes;
      }
      carry = offset < buffer.length ? buffer.subarray(offset) : Buffer.alloc(0);
    });
    child.on('error', () => {
      activeChildren.delete(child);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (aborted) reject(cancelError());
      else resolve([]);
    });
    child.on('close', () => {
      activeChildren.delete(child);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (aborted) reject(cancelError());
      else resolve(frames);
    });
  });
}

export async function analyzeAudioSignals(source, transcript, { signal } = {}) {
  if (signal?.aborted) throw cancelError();
  const segments = transcript?.segments ?? [];
  if (!segments.length) return transcript;
  const { ffmpeg } = await getMediaTools().catch(() => ({ ffmpeg: null }));
  const frames = ffmpeg ? await computeAudioFrames(ffmpeg, source, signal) : [];
  const speechFrames = frames.filter((rms) => rms > 80).sort((a, b) => a - b);
  const medianRms = speechFrames.length ? speechFrames[Math.floor(speechFrames.length * 0.5)] : 0;
  const peakRms = speechFrames.length ? speechFrames[Math.floor(speechFrames.length * 0.96)] : 0;
  const spread = Math.max(1, peakRms - medianRms * 0.45);

  const enriched = segments.map((segment, index) => {
    const duration = Math.max(0.2, segment.end - segment.start);
    const wordCount = segment.words?.length || segment.text.trim().split(/\s+/).filter(Boolean).length;
    const wps = Number((wordCount / duration).toFixed(1));
    const pauseBefore = index > 0 ? Number(Math.max(0, segment.start - segments[index - 1].end).toFixed(2)) : 0;
    let energy;
    if (frames.length && peakRms > 0) {
      const startIdx = Math.max(0, Math.floor(segment.start / 0.2));
      const endIdx = Math.min(frames.length - 1, Math.floor(segment.end / 0.2));
      const slice = [];
      for (let i = startIdx; i <= endIdx; i++) slice.push(frames[i]);
      if (slice.length) {
        slice.sort((a, b) => a - b);
        const segPeak = slice[Math.floor(slice.length * 0.85)];
        const normalized = Math.max(0, Math.min(1, (segPeak - medianRms * 0.45) / spread));
        energy = Math.max(1, Math.min(10, Math.round(1 + normalized * 9)));
      }
    }
    return { ...segment, wps, pauseBefore, ...(energy !== undefined ? { energy } : {}) };
  });
  return { ...transcript, segments: enriched };
}

export async function sampleFrames(source, directory, clip, clipNumber, { signal } = {}) {
  const tools = await getMediaTools();
  const duration = clip.end - clip.start;
  const count = Math.min(8, Math.max(4, Math.ceil(duration / 7)));
  const offsets = Array.from({ length: count }, (_, index) => 0.12 + index * (duration - 0.5) / (count - 1));
  const { stderr } = await runFfmpeg(tools.ffmpeg, tools.cuda, (useCuda) => [
    '-hide_banner', ...(useCuda ? ['-hwaccel', 'cuda'] : []),
    '-ss', decimal(clip.start), '-t', decimal(duration), '-i', source,
    '-an', '-vf', "fps=5,scale=320:-2,select='gt(scene,0.24)',showinfo", '-f', 'null', '-',
  ], { cwd: directory, timeout: 6 * 60_000, signal });
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]))
    .filter((time) => time > 0.4 && time < duration - 0.4);
  for (const time of cuts) {
    if (offsets.length >= 12) break;
    if (offsets.every((point) => Math.abs(time - point) > 0.55)) offsets.push(time + 0.06);
  }
  return extractFrames(tools, source, directory, `frame-${clipNumber}`, offsets.sort((a, b) => a - b), clip.start, signal);
}

export async function sampleSourceFrames(source, directory, duration, { signal } = {}) {
  const tools = await getMediaTools();
  return extractFrames(tools, source, directory, 'source-layout', [0.08, 0.29, 0.55, 0.77, 0.92].map((ratio) => ratio * duration), 0, signal);
}

export async function sampleInsetFrames(source, directory, clip, clipNumber, { signal } = {}) {
  const tools = await getMediaTools();
  const duration = clip.end - clip.start;
  return extractFrames(tools, source, directory, `inset-${clipNumber}`, [0.12, 0.50, 0.88].map((ratio) => ratio * duration), clip.start, signal);
}

async function extractFrames({ ffmpeg, cuda }, source, directory, prefix, offsets, start = 0, signal) {
  const frames = [];
  for (const [index, offset] of offsets.entries()) {
    const path = join(directory, `${prefix}-${index + 1}.jpg`);
    await runFfmpeg(ffmpeg, cuda, (useCuda) => [
      '-hide_banner', '-loglevel', 'error', '-y', ...(useCuda ? ['-hwaccel', 'cuda'] : []),
      '-ss', decimal(start + offset), '-i', source,
      '-frames:v', '1', '-an', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-q:v', '3', path,
    ], { cwd: directory, timeout: 90_000, signal });
    frames.push({ index: index + 1, offset, path, image: (await readFile(path)).toString('base64') });
  }
  return frames;
}

export async function locateWebcam(frames, point, size, { signal } = {}) {
  try {
    const args = [size.width, size.height, point.x, point.y].map(String);
    const env = pythonEnvironment();
    env.PYTHONPATH = [join(dataDir, 'vision-tools'), env.PYTHONPATH].join(delimiter);
    const { stdout } = await run(python, [webcamScript, ...args, ...frames.map(({ path }) => path)], {
      env, timeout: 20_000, signal,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    return null;
  }
}

export function startVisionWorker({ signal } = {}) {
  const env = pythonEnvironment();
  env.PYTHONPATH = [join(dataDir, 'vision-tools'), env.PYTHONPATH].join(delimiter);
  let child = null;
  let queue = Promise.resolve();
  const pending = [];
  let carry = '';
  let closed = false;

  const rejectAll = (err) => {
    while (pending.length) pending.shift().reject(err);
  };

  const ensureSpawned = () => {
    if (closed) throw new Error('Vision worker closed');
    if (signal?.aborted) throw cancelError();
    if (child && child.exitCode === null && child.signalCode === null) return;
    child = spawn(python, [webcamScript, '--worker'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    activeChildren.add(child);
    carry = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      carry += chunk;
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !pending.length) continue;
        const job = pending.shift();
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.ok) job.resolve(parsed.result);
          else job.reject(new Error(parsed.error || 'Vision worker error'));
        } catch (err) {
          job.reject(err);
        }
      }
    });
    child.on('error', (err) => {
      activeChildren.delete(child);
      rejectAll(signal?.aborted ? cancelError() : err);
    });
    child.on('close', () => {
      activeChildren.delete(child);
      rejectAll(signal?.aborted ? cancelError() : new Error('Vision worker exited'));
    });
  };

  let firstAnalyze = true;

  const analyze = (frames) => {
    const task = queue.then(() => {
      if (signal?.aborted) throw cancelError();
      ensureSpawned();
      const timeoutMs = firstAnalyze ? 95_000 : 45_000;
      firstAnalyze = false;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pending.indexOf(entry);
          if (idx !== -1) pending.splice(idx, 1);
          killProcessTree(child);
          reject(new Error('Vision worker timeout'));
        }, timeoutMs);
        const onAbort = () => {
          clearTimeout(timer);
          killProcessTree(child);
          reject(cancelError());
        };
        const entry = {
          resolve: (val) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(val); },
          reject: (err) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(err); },
        };
        pending.push(entry);
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stdin.write(`${JSON.stringify({ cmd: 'scene', paths: frames.map(({ path }) => path) })}\n`);
      });
    });
    queue = task.catch(() => {});
    return task;
  };

  const close = async () => {
    closed = true;
    const proc = child;
    child = null;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise((resolve) => {
      const killer = setTimeout(() => { killProcessTree(proc); resolve(); }, 1500);
      proc.once('close', () => { clearTimeout(killer); resolve(); });
      try { proc.stdin.end(`${JSON.stringify({ cmd: 'close' })}\n`); } catch { killProcessTree(proc); }
    });
  };

  return { analyze, close };
}

export async function analyzeClipScene(frames, { signal, worker } = {}) {
  if (!Array.isArray(frames) || !frames.length) return null;
  if (worker) {
    try {
      return await worker.analyze(frames);
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
    }
  }
  try {
    const env = pythonEnvironment();
    env.PYTHONPATH = [join(dataDir, 'vision-tools'), env.PYTHONPATH].join(delimiter);
    const { stdout } = await run(python, [webcamScript, '--scene', ...frames.map(({ path }) => path)], {
      env, timeout: 60_000, signal,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    return null;
  }
}

function assTime(seconds) {
  const value = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(value / 360000);
  const minutes = String(Math.floor(value / 6000) % 60).padStart(2, '0');
  const remainder = String(Math.floor(value / 100) % 60).padStart(2, '0');
  const centiseconds = String(value % 100).padStart(2, '0');
  return `${hours}:${minutes}:${remainder}.${centiseconds}`;
}

function sanitizeAssText(value) {
  return String(value ?? '').replace(/[\\{}\r\n]/g, ' ').replace(/\s+([,.:!?;])/g, '$1').replace(/\s+/g, ' ').trim();
}

function subtitleCues(clip, transcript) {
  const relevant = transcript.segments.filter((segment) => segment.end > clip.start && segment.start < clip.end);
  const hasWordTimings = relevant.some((segment) => segment.words?.length);
  const words = relevant
    .flatMap((segment) => segment.words?.length ? segment.words : [{ start: segment.start, end: segment.end, text: segment.text }])
    .filter((word) => word.end > clip.start && word.start < clip.end);
  const maxWords = hasWordTimings ? 4 : 7;
  const maxSpan = hasWordTimings ? 1.85 : 2.8;
  const maxGap = hasWordTimings ? 0.38 : 0.55;
  const maxChars = hasWordTimings ? 26 : 51;
  const cues = [];
  let group = [];
  for (const word of words) {
    const previous = group.at(-1);
    if (previous && (group.length >= maxWords || word.end - group[0].start > maxSpan || word.start - previous.end > maxGap ||
      group.map(({ text }) => text).join(' ').length + word.text.length > maxChars)) {
      cues.push(group);
      group = [];
    }
    group.push(word);
    if (/[.?!…]$/.test(word.text) && group.length >= (hasWordTimings ? 2 : 3)) {
      cues.push(group);
      group = [];
    }
  }
  if (group.length) cues.push(group);
  return cues.map((cue, index) => {
    const start = Math.max(clip.start, cue[0].start);
    const nextStart = cues[index + 1]?.[0].start ?? clip.end;
    const end = Math.min(clip.end, nextStart, Math.max(cue.at(-1).end, start + (hasWordTimings ? 0.25 : 0.45)));
    const tokens = cue.map((word, wordIndex) => {
      const wStart = Math.max(start, word.start);
      const nextWordStart = cue[wordIndex + 1]?.start ?? end;
      const wEnd = Math.min(end, Math.max(wStart + 0.04, nextWordStart));
      return { start: wStart - clip.start, end: wEnd - clip.start, text: sanitizeAssText(word.text) };
    }).filter(({ text }) => text);
    const text = sanitizeAssText(cue.map((word) => word.text).join(' '));
    return { start: start - clip.start, end: end - clip.start, text, tokens: hasWordTimings && tokens.length > 1 ? tokens : null };
  }).filter(({ start, end, text }) => end - start > 0.02 && text);
}

function wrapHookLines(text, maxLine = 22) {
  if (text.length <= maxLine) return text;
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 3) return lines.join('\\N');
  return `${lines[0]}\\N${lines[1]}\\N${lines.slice(2).join(' ')}`;
}

function highlightHookText(assMultilineText) {
  const words = assMultilineText.split(/\s+/);
  const plainCount = words.filter((w) => w.replace(/\\N/g, '').length > 0).length;
  let accentBudget = plainCount >= 4 ? 2 : 1;
  return assMultilineText.split('\\N').map((line) => line.split(' ').map((token) => {
    const clean = token.replace(/[¿¡?!.,:;()"'«»]/g, '');
    const isStrong = /\d/.test(clean) || (clean.length >= 4 && clean === clean.toUpperCase()) || (clean.length >= 7 && accentBudget > 0);
    if (accentBudget > 0 && isStrong) {
      accentBudget--;
      return `{\\c&H0000EAFF&}${token}{\\c&H00FFFFFF&}`;
    }
    return token;
  }).join(' ')).join('\\N');
}

function rawFitAspect(format, plan, aspect) {
  if (format.fitCrop === '4:3') return 4 / 3;
  if (format.fitCrop === '1:1') return 1;
  const r0 = plan.regions?.[0];
  if (r0 && (r0.width < 0.99 || r0.height < 0.99)) {
    return ((r0.width || 1) * (aspect || 16 / 9)) / Math.max(0.05, r0.height || 1);
  }
  return aspect || 16 / 9;
}

function buildNarratorEvents(words = [], narratorText = '', { voiceDelay = 0.62, previewDur = 0.5, freezeDur = 3.5, width = 1080, height = 1920, scale = 1, fgTop = 524, fgHeight = 608 } = {}) {
  const events = [];
  const freezeEnd = previewDur + freezeDur;
  const narratorY = Math.min(height - Math.round(420 * scale), Math.round(fgTop + fgHeight + 92 * scale));
  events.push(
    `Dialogue: 2,${assTime(previewDur)},${assTime(Math.min(freezeEnd, previewDur + 0.55))},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(fgTop + Math.round(52 * scale))})\\fscx125\\fscy125\\t(0,150,\\fscx100\\fscy100)\\fad(0,180)\\c&H0000EAFF&}⏸ PAUSA`,
  );
  const cleanWords = words.length ? words : String(narratorText || '').trim().split(/\s+/).filter(Boolean).map((t, i, arr) => ({
    start: (i / Math.max(1, arr.length)) * Math.max(0.5, freezeDur - 0.5),
    end: ((i + 1) / Math.max(1, arr.length)) * Math.max(0.5, freezeDur - 0.5),
    text: t,
  }));
  const chunkSize = 5;
  for (let offset = 0; offset < cleanWords.length; offset += chunkSize) {
    const chunk = cleanWords.slice(offset, offset + chunkSize);
    const cStart = voiceDelay + chunk[0].start;
    const cEnd = Math.min(freezeEnd, voiceDelay + chunk.at(-1).end + 0.14);
    for (const [idx, tok] of chunk.entries()) {
      const sStart = idx === 0 ? cStart : voiceDelay + tok.start;
      const sEnd = idx === chunk.length - 1 ? cEnd : Math.min(cEnd, voiceDelay + chunk[idx + 1].start);
      if (sEnd - sStart <= 0.02) continue;
      const formatted = chunk.map((w, j) => {
        const safe = sanitizeAssText(w.text);
        return j === idx ? `{\\c&H0000EAFF&\\fscx112\\fscy112}${safe}{\\r}` : safe;
      }).join(' ');
      events.push(`Dialogue: 2,${assTime(sStart)},${assTime(sEnd)},Narrator,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${narratorY})}${formatted}`);
    }
  }
  return events;
}

async function writeSubtitles(path, clip, transcript, format, plan = {}, { aspect = 16 / 9, prototypeOverlay = null } = {}) {
  const [width, height] = outputSize(format);
  const scale = Math.min(width / 1080, height / 1920);
  const font = Math.round(72 * scale);
  const marginV = Math.round(height * 310 / 1920);
  const layout = plan.layout ?? (plan.mode === 'follow' ? 'fill' : 'fit');
  const insetLayout = ['gameplay', 'shared'].includes(layout);
  const fgAspect = rawFitAspect(format, plan, aspect);
  const fgWidth = Math.min(width, Math.round(height * fgAspect));
  const fgHeight = Math.min(height, Math.round(fgWidth / fgAspect));
  const fgTop = containOffsetY(height, fgHeight, 'fit');
  const badgeBottom = Math.round(height * 7 / 120) + 84;

  // Compute exact empty blurred band above gameplay/shared content panel (below webcam panel).
  let insetPanelTop = 0;
  let insetGapHeight = 0;
  if (insetLayout) {
    const panels = layoutPanels(layout, format.ratio);
    const panel1 = panels[1] ?? panels[0];
    const reg1 = plan.regions?.[1] ?? { width: 1, height: 1 };
    const contentAspect = ((reg1.width || 1) * (aspect || 16 / 9)) / Math.max(0.05, reg1.height || 1);
    const visibleFgH = contentAspect > (panel1.width / panel1.height)
      ? Math.round(panel1.width / contentAspect)
      : panel1.height;
    insetPanelTop = panel1.y;
    insetGapHeight = containOffsetY(panel1.height, visibleFgH, 'bottom');
  }

  const gapHeight = layout === 'fit' ? fgTop - badgeBottom : insetGapHeight;
  const persistentFitHook = layout === 'fit' && gapHeight >= 90;
  const persistentInsetHook = insetLayout;

  const rawHook = clip.onScreenHook || clip.title;
  const hook = sanitizeAssText(rawHook).slice(0, 72);
  const formattedHook = wrapHookLines(hook, width > height ? 28 : (persistentFitHook ? 22 : (persistentInsetHook ? 23 : 20)));
  const lineCount = formattedHook ? formattedHook.split('\\N').length : 0;

  const hookFont = persistentFitHook
    ? (lineCount >= 2
      ? Math.min(60, Math.max(36, Math.round(gapHeight * 0.155)))
      : Math.min(76, Math.max(42, Math.round(gapHeight * 0.21))))
    : (persistentInsetHook
      ? (insetGapHeight >= 110
        ? (lineCount >= 2
          ? Math.min(56, Math.max(36, Math.round(insetGapHeight * 0.23)))
          : Math.min(68, Math.max(42, Math.round(insetGapHeight * 0.28))))
        : Math.max(36, Math.round(52 * scale)))
      : Math.max(46, Math.round((lineCount >= 2 ? 68 : 78) * scale)));
  const hookAlign = (persistentFitHook || persistentInsetHook) ? 5 : 8;
  const hookMarginV = (persistentFitHook || persistentInsetHook) ? 0 : Math.round(height * 226 / 1920);
  const hookOutline = Math.max(5, Math.round(8 * scale));
  const hookShadow = Math.max(3, Math.round(4 * scale));
  const hookStyle = `Style: Hook,Arial Black,${hookFont},&H00FFFFFF,&H00FFFFFF,&H0008080F,&HB0000000,-1,0,0,0,100,100,1,0,1,${hookOutline},${hookShadow},${hookAlign},74,74,${hookMarginV},1`;
  const narratorStyle = `Style: Narrator,Arial Black,${Math.round(62 * scale)},&H00FFFFFF,&H00FFFFFF,&H0008080F,&HC8080810,-1,0,0,0,100,100,0,0,1,${Math.max(4, Math.round(7 * scale))},${Math.max(2, Math.round(3 * scale))},5,64,64,0,1`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Corte,Arial Black,${font},&H00FFFFFF,&H00FFFFFF,&H0008080F,&HB0000000,-1,0,0,0,100,100,0,0,1,${Math.max(4, Math.round(7 * scale))},${Math.max(2, Math.round(3 * scale))},2,90,90,${marginV},1
${hookStyle}
${narratorStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  if (hook) {
    const richHook = highlightHookText(formattedHook);
    const popTag = '\\fscx84\\fscy84\\t(0,170,\\fscx108\\fscy108)\\t(170,290,\\fscx100\\fscy100)';
    const clipDuration = Math.max(0.5, prototypeOverlay?.totalDuration ?? (clip.end - clip.start));
    if (persistentFitHook) {
      const gapCenterY = Math.round(badgeBottom + gapHeight / 2);
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(clipDuration)},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${gapCenterY})${popTag}}${richHook}`);
    } else if (persistentInsetHook) {
      const insetHookY = insetGapHeight >= 76
        ? Math.round(insetPanelTop + insetGapHeight / 2)
        : Math.round(insetPanelTop + Math.max(58, Math.round(62 * scale)));
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(clipDuration)},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${insetHookY})${popTag}}${richHook}`);
    } else {
      const hookEnd = Math.min(4.2, Math.max(1.2, clipDuration * 0.55));
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookEnd)},Hook,,0,0,0,,{${popTag}\\fad(80,260)}${richHook}`);
    }
  }
  if (prototypeOverlay) {
    lines.push(...buildNarratorEvents(prototypeOverlay.words, prototypeOverlay.text, {
      voiceDelay: prototypeOverlay.voiceDelay,
      previewDur: prototypeOverlay.previewDur,
      freezeDur: prototypeOverlay.freezeDur,
      width, height, scale, fgTop, fgHeight,
    }));
  }
  const shiftTime = prototypeOverlay ? prototypeOverlay.freezeDur : 0;
  const cueMinTime = prototypeOverlay ? prototypeOverlay.previewDur : 0;
  const maxVideoTime = prototypeOverlay ? prototypeOverlay.totalDuration : Infinity;
  for (const cue of subtitleCues(clip, transcript)) {
    if (prototypeOverlay && cue.end <= cueMinTime) continue;
    const adjStart = Math.max(cueMinTime + shiftTime, cue.start + shiftTime);
    const adjEnd = Math.min(maxVideoTime, cue.end + shiftTime);
    if (adjEnd - adjStart <= 0.02) continue;
    if (!cue.tokens) {
      lines.push(`Dialogue: 0,${assTime(adjStart)},${assTime(adjEnd)},Corte,,0,0,0,,${cue.text}`);
      continue;
    }
    for (const [activeIndex, token] of cue.tokens.entries()) {
      const rawStart = activeIndex === 0 ? cue.start : token.start;
      const rawEnd = activeIndex === cue.tokens.length - 1 ? cue.end : cue.tokens[activeIndex + 1].start;
      const spanStart = Math.max(cueMinTime + shiftTime, rawStart + shiftTime);
      const spanEnd = Math.min(maxVideoTime, rawEnd + shiftTime);
      if (spanEnd - spanStart <= 0.02) continue;
      const formatted = cue.tokens.map((entry, idx) =>
        idx === activeIndex ? `{\\c&H0000EAFF&\\fscx112\\fscy112}${entry.text}{\\r}` : entry.text
      ).join(' ');
      lines.push(`Dialogue: 0,${assTime(spanStart)},${assTime(spanEnd)},Corte,,0,0,0,,${formatted}`);
    }
  }
  await writeFile(path, `${header}${lines.join('\n')}\n`, 'utf8');
}

export async function listVoiceModels() {
  const { ffmpeg } = await getMediaTools();
  try {
    const { stdout } = await run(python, [voiceoverScript, '--list', '--models-dir', ttsModelsDir, '--ffmpeg', ffmpeg], {
      env: pythonEnvironment(), timeout: 10_000,
    });
    return JSON.parse(stdout.trim());
  } catch {
    return [
      { id: 'piper:es_ES-davefx-medium', label: 'Piper Local · es_ES-davefx-medium (Offline)', engine: 'piper', local: true },
      { id: 'edge:es-ES-AlvaroNeural', label: 'Álvaro Neural · Locutor TV (ES)', engine: 'edge', local: false },
    ];
  }
}

export async function synthesizeVoiceover(text, outPath, { voice = 'piper:es_ES-davefx-medium', signal } = {}) {
  const { ffmpeg } = await getMediaTools();
  await mkdir(dirname(outPath), { recursive: true });
  const { stdout } = await run(
    python,
    [voiceoverScript, '--text', String(text || '').trim(), '--out', outPath, '--voice', voice, '--models-dir', ttsModelsDir, '--ffmpeg', ffmpeg],
    { env: pythonEnvironment(), timeout: 60_000, signal },
  );
  const parsed = JSON.parse(stdout.trim());
  if (!parsed?.path || !Number.isFinite(parsed.duration)) {
    throw new RequestError(502, 'El modelo de voz local no devolvió un audio válido.');
  }
  return parsed;
}

export async function renderPrototypeClip(source, directory, clip, transcript, plan, clipNumber, format = defaultFormat, mediaOptions = {}) {
  const { ffmpeg, cuda, nvenc } = await getMediaTools();
  const { signal, voice = 'piper:es_ES-davefx-medium' } = mediaOptions;
  const name = `clip-${clipNumber}`;
  const wavPath = join(directory, `${name}-voice.wav`);
  const narrationText = (clip.narration || clip.onScreenHook || clip.title || '').trim();
  const vo = await synthesizeVoiceover(narrationText, wavPath, { voice, signal });

  const [width, height] = outputSize(format);
  const previewDur = 0.5;
  const voiceDelay = 0.62;
  const freezeDur = Math.max(2.2, Number((0.12 + vo.duration + 0.28).toFixed(2)));
  const maxBodyDur = Math.max(3.5, Number((29.5 - previewDur - freezeDur).toFixed(2)));
  const bodyDur = Math.max(3.5, Math.min(maxBodyDur, Number((clip.end - clip.start - previewDur).toFixed(2))));
  const totalDuration = Number((previewDur + freezeDur + bodyDur).toFixed(2));
  const protoPlan = { ...plan, layout: 'fit' };

  await writeSubtitles(join(directory, `${name}.ass`), clip, transcript, format, protoPlan, {
    ...mediaOptions,
    prototypeOverlay: { previewDur, freezeDur, voiceDelay, totalDuration, words: vo.words, text: narrationText },
  });

  const baseGraph = compositionGraph(protoPlan, format);
  const rounded = 'clip(15-hypot(max(abs(X-(W-1)/2)-(W/2-15),0),max(abs(Y-(H-1)/2)-(H/2-15),0)),0,1)';
  const freezeTail = Math.max(0.05, freezeDur - 0.06);
  const fadeOutSt = Math.max(0.01, previewDur - 0.06);
  const pauseMs = Math.round(previewDur * 1000);
  const voiceMs = Math.round(voiceDelay * 1000);
  const resumeMs = Math.round((previewDur + freezeDur - 0.05) * 1000);

  const freezeFx = [
    `trim=start=${decimal(previewDur)}:duration=0.06,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${decimal(freezeDur)},trim=duration=${decimal(freezeDur)},fps=30`,
    `scale=w='trunc(${width}*(1+0.065*min(1,t/0.22)*min(1,max(0,(${decimal(freezeDur)}-t)/0.22)))/2)*2':h='trunc(${height}*(1+0.065*min(1,t/0.22)*min(1,max(0,(${decimal(freezeDur)}-t)/0.22)))/2)*2':flags=bilinear:eval=frame`,
    `crop=${width}:${height}:(in_w-${width})/2:(in_h-${height})/2,setsar=1`,
    `eq=brightness='0.22*exp(-pow(t/0.07,2))-0.09*(1-exp(-pow(t/0.14,2)))+0.24*exp(-pow((t-${decimal(freezeTail)})/0.06,2))':saturation='0.48+0.52*max(exp(-pow(t/0.12,2)),exp(-pow((t-${decimal(freezeTail)})/0.08,2)))':eval=frame`,
  ].join(',');

  const videoGraph = [
    `${baseGraph},fps=30,setsar=1,split=3[p_raw][f_raw][b_raw]`,
    `[p_raw]trim=start=0:duration=${decimal(previewDur)},setpts=PTS-STARTPTS[seg0]`,
    `[f_raw]${freezeFx}[seg1]`,
    `[b_raw]trim=start=${decimal(previewDur)}:duration=${decimal(bodyDur)},setpts=PTS-STARTPTS,eq=brightness='0.14*exp(-pow(t/0.08,2))':eval=frame[seg2]`,
    `[seg0][seg1][seg2]concat=n=3:v=1:a=0,fps=30,setsar=1,ass=${name}.ass[captioned]`,
    `[1:v]scale=60:60,format=rgba,pad=310:84:12:12:color=0x171820@0.78,drawtext=font='Segoe UI Semibold':text='${youtubeHandle}':fontsize=40:fontcolor=white:x=85:y=(h-th)/2,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${rounded}'[brand]`,
    `[captioned][brand]overlay=x=(W-w)/2:y=H*7/120:eof_action=repeat[out]`,
  ].join(';');

  const audioGraph = [
    `[0:a]atrim=start=0:duration=${decimal(previewDur)},asetpts=PTS-STARTPTS,afade=t=out:st=${decimal(fadeOutSt)}:d=0.06[a0]`,
    `anullsrc=r=44100:cl=stereo:d=${decimal(freezeDur)}[a1]`,
    `[0:a]atrim=start=${decimal(previewDur)}:duration=${decimal(bodyDur)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.08[a2]`,
    `[a0][a1][a2]concat=n=3:v=0:a=1[a_base]`,
    `aevalsrc='0.28*sin(2*PI*(165-115*t/0.22)*t)*exp(-t*14)':s=44100:d=0.24,aformat=channel_layouts=stereo,adelay=${pauseMs}|${pauseMs}[sfx_p]`,
    `aevalsrc='0.24*sin(2*PI*(170+260*t/0.18)*t)*exp(-t*16)':s=44100:d=0.20,aformat=channel_layouts=stereo,adelay=${resumeMs}|${resumeMs}[sfx_r]`,
    `[2:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.32,adelay=${voiceMs}|${voiceMs}[vo]`,
    `[a_base][sfx_p][vo][sfx_r]amix=inputs=4:duration=first:normalize=0,alimiter=limit=0.95[aout]`,
  ].join(';');

  const partial = join(directory, `${name}.partial.mp4`);
  const videoEncoder = nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4'];
  try {
    await runFfmpeg(ffmpeg, cuda, (useCuda) => [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...(useCuda ? ['-hwaccel', 'cuda'] : []), '-ss', decimal(clip.start), '-i', source,
      '-i', watermark, '-i', vo.path, '-filter_complex_threads', '2', '-filter_complex', `${videoGraph};${audioGraph}`,
      '-map', '[out]', '-map', '[aout]', ...videoEncoder,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', partial,
    ], { cwd: directory, timeout: 30 * 60_000, signal });
    await rename(partial, join(directory, `${name}.mp4`));
    return `${name}.mp4`;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    if (error.code === 'CANCELLED') throw error;
    throw new RequestError(502, `FFmpeg no pudo exportar el clip prototipo ${clipNumber}. ${error.message.split(/\r?\n/).at(-1)?.slice(0, 160) ?? ''}`.trim());
  } finally {
    await rm(wavPath, { force: true }).catch(() => {});
  }
}

export async function renderClip(source, directory, clip, transcript, plan, clipNumber, format = defaultFormat, mediaOptions = {}) {
  const { ffmpeg, cuda, nvenc } = await getMediaTools();
  const { signal } = mediaOptions;
  const name = `clip-${clipNumber}`;
  await writeSubtitles(join(directory, `${name}.ass`), clip, transcript, format, plan, mediaOptions);
  let graph = compositionGraph(plan, format);
  const rounded = 'clip(15-hypot(max(abs(X-(W-1)/2)-(W/2-15),0),max(abs(Y-(H-1)/2)-(H/2-15),0)),0,1)';
  const badgeY = ['gameplay', 'shared'].includes(plan.layout) ? '12' : 'H*7/120';
  graph += `,fps=30,setsar=1,ass=${name}.ass[captioned];[1:v]scale=60:60,format=rgba,pad=310:84:12:12:color=0x171820@0.78,drawtext=font='Segoe UI Semibold':text='${youtubeHandle}':fontsize=40:fontcolor=white:x=85:y=(h-th)/2,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${rounded}'[brand];[captioned][brand]overlay=x=(W-w)/2:y=${badgeY}:eof_action=repeat[out]`;
  const partial = join(directory, `${name}.partial.mp4`);
  const videoEncoder = nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4'];
  try {
    await runFfmpeg(ffmpeg, cuda, (useCuda) => [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...(useCuda ? ['-hwaccel', 'cuda'] : []), '-ss', decimal(clip.start), '-i', source,
      '-i', watermark, '-t', decimal(clip.end - clip.start), '-filter_complex_threads', '2', '-filter_complex', graph,
      '-map', '[out]', '-map', '0:a:0?', ...videoEncoder,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', partial,
    ], { cwd: directory, timeout: 30 * 60_000, signal });
    await rename(partial, join(directory, `${name}.mp4`));
    return `${name}.mp4`;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    if (error.code === 'CANCELLED') throw error;
    throw new RequestError(502, `FFmpeg no pudo exportar el clip ${clipNumber}. ${error.message.split(/\r?\n/).at(-1)?.slice(0, 160) ?? ''}`.trim());
  }
}
