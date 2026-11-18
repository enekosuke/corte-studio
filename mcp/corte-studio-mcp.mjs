#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import youtubeMod from '../dist/youtube.js';
import { buildAgentCandidates, buildAgentFramingPlan, cvFramingPlan } from '../pipeline/analysis.mjs';
import { defaultFormat, formatCatalog, normalizeFormat } from '../pipeline/formats.mjs';
import {
  buildWaveform,
  findCachedSourceByVideoId,
  getJob,
  getSourceFile,
  jobDirectory,
  jobsDir,
  linkOrCopy,
  listJobs,
  readCheckpoint,
  saveJobRecord,
} from '../pipeline/jobs.mjs';
import {
  analyzeAudioSignals,
  analyzeClipScene,
  dataDir,
  downloadVideo,
  probeVideo,
  renderClip,
  sampleFrames,
  startVisionWorker,
  transcribeVideo,
} from '../pipeline/media.mjs';
import { loadPublication, saveAgentSeoSuggestion } from '../pipeline/publication.mjs';
import { uploadProjectToYouTube } from '../pipeline/youtube_upload.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'corte-studio', version: '1.0.0' };
const STUDIO_ORIGIN = process.env.CORTE_STUDIO_ORIGIN || 'http://127.0.0.1:4173';
const WORKER_IDLE_MS = 45_000;

// Preserve raw stdout exclusively for MCP JSON-RPC frames; route console logs to stderr.
const rawStdoutWrite = process.stdout.write.bind(process.stdout);
for (const level of ['log', 'info', 'debug']) {
  console[level] = (...args) => {
    process.stderr.write(`[corte-studio-mcp] ${format(...args)}\n`);
  };
}

let cachedWorker = null;
let workerIdleTimer = null;

function writeRpc(payload) {
  rawStdoutWrite(`${JSON.stringify(payload)}\n`);
}

function writeResult(id, result) {
  writeRpc({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message, data) {
  writeRpc({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function resetWorkerIdleTimer() {
  if (workerIdleTimer) clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(() => {
    void closeSharedWorker();
  }, WORKER_IDLE_MS);
  workerIdleTimer.unref?.();
}

function getSharedWorker() {
  if (!cachedWorker) cachedWorker = startVisionWorker({});
  resetWorkerIdleTimer();
  return cachedWorker;
}

async function closeSharedWorker() {
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
  const worker = cachedWorker;
  cachedWorker = null;
  if (worker) await worker.close().catch(() => {});
}

async function writeAtomicJson(targetPath, data) {
  const staging = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, JSON.stringify(data, null, 2), 'utf8');
    await rename(staging, targetPath);
  } finally {
    await rm(staging, { force: true }).catch(() => {});
  }
}

function requireJobId(args) {
  const jobId = typeof args?.jobId === 'string' ? args.jobId.trim() : '';
  if (!jobId) throw new Error('Se requiere jobId válido.');
  return jobId;
}

async function loadAgentJobContext(jobId) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`No existe el proyecto ${jobId}.`);
  const directory = jobDirectory(job);
  const sourcePath = await getSourceFile(jobId);
  const transcript = await readCheckpoint(directory, 'transcript.json');
  const candidates = await readCheckpoint(directory, 'candidates.json');
  return { job, directory, sourcePath, transcript, candidates };
}

function parseClipIndex(args, candidates) {
  const idx = Number(args?.clipIndex);
  if (!Number.isInteger(idx) || idx < 1 || idx > (candidates?.length ?? 0)) {
    throw new Error(`clipIndex fuera de rango (debe ser 1..${candidates?.length ?? 0}).`);
  }
  return idx;
}

const TOOL_DEFINITIONS = [
  {
    name: 'studio_inspect_formats',
    description: 'Inspect Corte Studio output ratios, framing layouts, crop modes, and local workspace paths before starting.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_list_projects',
    description: 'List saved Corte Studio video projects on disk with job IDs, stages, clip counts, durations, and Studio URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum projects to return (default 15).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'studio_get_project',
    description: 'Inspect full metadata, saved clip candidates, rendered MP4 paths, and SEO suggestions for a Corte Studio project.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'UUID of the Corte Studio project.' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_prepare_video',
    description: 'Prepare a YouTube URL/ID or Twitch URL (live stream from 00:00 up to right now, VOD /videos/ID, or clip) for agent-led clipping: reuse cached 2K source (for immutable videos/VODs) or download fresh, probe media, run Whisper GPU transcription + audio energy analysis, and create/update a Studio project.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube URL/11-char videoId, or Twitch URL (channel live, /videos/ID VOD, or clip).' },
        jobId: { type: 'string', description: 'Optional existing jobId to inspect/reuse if already created.' },
        format: {
          type: 'object',
          description: 'Optional output format config (ratio, layouts, fitCrop, contentCrop). Defaults to 9:16 + auto.',
          properties: {
            ratio: { type: 'string', enum: ['9:16', '4:5', '1:1', '16:9'] },
            layouts: { type: 'array', items: { type: 'string', enum: ['gameplay', 'shared', 'split', 'three', 'four', 'fill', 'fit'] } },
            fitCrop: { type: 'string', enum: ['original', '4:3', '1:1'] },
            contentCrop: { type: 'string', enum: ['auto', 'side', 'below'] },
          },
        },
        retranscribe: { type: 'boolean', description: 'Force re-running Whisper + audio analysis even if transcript.json exists.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_read_transcript_window',
    description: 'Read a paginated window of the timestamped Whisper transcript (with acoustic energy and speech rate) so YOU (the calling agent) can pick viral clips directly without external LLM calls.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'UUID of the prepared project.' },
        offsetSegmentIndex: { type: 'integer', minimum: 0, description: '0-based segment index to start from.' },
        startTime: { type: 'number', minimum: 0, description: 'Optional start timestamp in seconds (overrides offsetSegmentIndex).' },
        endTime: { type: 'number', minimum: 0, description: 'Optional end timestamp in seconds.' },
        maxSegments: { type: 'integer', minimum: 1, maximum: 250, description: 'Max segments per page (default 80).' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_save_candidates',
    description: 'Save viral clip selections chosen by the agent. Automatically snaps boundaries to exact spoken words, boosts with acoustic energy, deduplicates overlaps, and records candidates.json for timeline preview.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'UUID of the project.' },
        clips: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              startSegmentId: { type: 'integer', description: 'Transcript segment ID where the clip begins.' },
              endSegmentId: { type: 'integer', description: 'Transcript segment ID where the clip ends.' },
              start: { type: 'number', description: 'Fallback start time in seconds if segment IDs are omitted.' },
              end: { type: 'number', description: 'Fallback end time in seconds if segment IDs are omitted.' },
              title: { type: 'string', description: 'Catchy viral title in the video language.' },
              onScreenHook: { type: 'string', description: 'Short punchy 3-7 word overlay hook (e.g. "CASI PIERDE TODO EN 10 SEGUNDOS").' },
              category: { type: 'string', description: 'Content vibe (e.g. Clímax, Polémica, Historia, Gameplay, Consejo).' },
              reason: { type: 'string', description: 'Why this segment has strong hook, retention, and share value.' },
              score: { type: 'number', minimum: 1, maximum: 10 },
              hookScore: { type: 'number', minimum: 1, maximum: 10 },
              retentionScore: { type: 'number', minimum: 1, maximum: 10 },
              shareScore: { type: 'number', minimum: 1, maximum: 10 },
              clarityScore: { type: 'number', minimum: 1, maximum: 10 },
            },
            required: ['title', 'reason'],
          },
        },
      },
      required: ['jobId', 'clips'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_analyze_clip_frames',
    description: 'Extract real .jpg frames for a clip and run the local GPU hybrid vision stack (EmbeddingGemma 2 + SigLIP 2 + YOLOv8 Face + YOLO11 Pose + OpenCV snap_webcam_box). Returns frame file paths for direct agent visual inspection via read_file plus scene coordinates and a suggested framing plan.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        clipIndex: { type: 'integer', minimum: 1, description: '1-based index into candidates.json.' },
      },
      required: ['jobId', 'clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_render_clip',
    description: 'Render clip-N.mp4 with FFmpeg (up to 2K source -> crisp MP4 + massive kinetic Arial Black ASS subtitles). Accepts an optional custom framing spec from the agent after inspecting .jpg frames, or uses the local vision CV plan automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        clipIndex: { type: 'integer', minimum: 1 },
        title: { type: 'string', description: 'Optional updated clip title.' },
        onScreenHook: { type: 'string', description: 'Optional updated massive kinetic on-screen hook overlay.' },
        framing: {
          type: 'object',
          description: 'Optional agent-chosen layout and normalized [0..1] crop boxes (omit to auto-use local vision plan).',
          properties: {
            layout: { type: 'string', enum: ['gameplay', 'shared', 'split', 'three', 'four', 'fill', 'fit'] },
            reason: { type: 'string' },
            cameraBox: {
              type: 'object',
              description: 'Webcam inset box in normalized [0..1] coordinates { left, top, right, bottom }.',
              properties: { left: { type: 'number' }, top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' } },
              required: ['left', 'top', 'right', 'bottom'],
            },
            screenBox: {
              type: 'object',
              description: 'Primary gameplay/content screen box in normalized [0..1] coordinates.',
              properties: { left: { type: 'number' }, top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' } },
              required: ['left', 'top', 'right', 'bottom'],
            },
            focusBox: {
              type: 'object',
              description: 'Single-subject focus box for fill/fit layouts in normalized [0..1] coordinates.',
              properties: { left: { type: 'number' }, top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' } },
              required: ['left', 'top', 'right', 'bottom'],
            },
            frames: {
              type: 'array',
              description: 'Optional per-frame tracking boxes [{ index, cutBefore, regions: [{ left, top, right, bottom }] }].',
              items: { type: 'object' },
            },
          },
        },
      },
      required: ['jobId', 'clipIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_save_seo_package',
    description: 'Save full viral SEO & publication copy authored by the calling agent for a rendered clip (query, hook, seoKeywords, coverText, pinnedComment, seoScore, YouTube Shorts title/text/hashtags, TikTok text/hashtags).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        clipIndex: { type: 'integer', minimum: 1, description: '1-based clip index (resolves to clip-N.mp4).' },
        seo: {
          type: 'object',
          required: ['query', 'hook', 'youtubeTitle', 'youtubeText', 'youtubeHashtags', 'tiktokText', 'tiktokHashtags'],
          properties: {
            game: { type: 'string', description: 'Exact videogame title when the clip is gameplay (e.g., "GTA 6", "Valorant", "Minecraft").' },
            query: { type: 'string' },
            hook: { type: 'string' },
            seoKeywords: { type: 'array', items: { type: 'string' } },
            coverText: { type: 'string' },
            pinnedComment: { type: 'string' },
            seoScore: { type: 'number', minimum: 1, maximum: 100 },
            youtubeTitle: { type: 'string' },
            youtubeText: { type: 'string' },
            youtubeHashtags: { type: 'array', items: { type: 'string' } },
            tiktokText: { type: 'string' },
            tiktokHashtags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['jobId', 'clipIndex', 'seo'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_finish_project',
    description: 'Finalize the project (marks stage="done", releases GPU vision worker, returns all rendered clip URLs + Studio Web UI link).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_upload_youtube_batch',
    description: 'Upload and schedule rendered clips from a Corte Studio project via the official YouTube Data API v3 (requires Google OAuth client secret at .corte-data/youtube-client-secret.json), spacing publishAt cleanly by intervalHours.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        intervalHours: { type: 'number', minimum: 0, maximum: 72, description: 'Hours between scheduled Shorts (default 1).' },
        startAtIso: { type: 'string', description: 'Optional ISO-8601 UTC start time for clip 1 (defaults to next rounded hour).' },
        maxClips: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
];

async function handleInspectFormats() {
  return {
    studioOrigin: STUDIO_ORIGIN,
    dataDir,
    jobsDir,
    defaultFormat,
    catalog: formatCatalog,
    notes: {
      layouts: {
        gameplay: 'Top/corner cropped streamer webcam + main gameplay crop with zero webcam overlap.',
        shared: 'Inset presenter box + shared screen/react content crop.',
        split: 'Two-person side-by-side / stacked panel split.',
        fill: 'Dynamic 9:16 single-subject tracking crop following speaker or action.',
        fit: 'Full frame preserved with blurred aesthetic letterbox backdrop and bold kinetic hook.',
      },
    },
  };
}

async function handleListProjects(args) {
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 15));
  const projects = (await listJobs()).slice(0, limit).map((item) => ({
    ...item,
    studioUrl: `${STUDIO_ORIGIN}/?job=${item.id}`,
  }));
  return { total: projects.length, studioOrigin: STUDIO_ORIGIN, projects };
}

async function handleGetProject(args) {
  const jobId = requireJobId(args);
  const { job, directory, sourcePath, transcript, candidates } = await loadAgentJobContext(jobId);
  const publications = [];
  for (const clip of job.clips ?? []) {
    const pub = await loadPublication(directory, job, clip).catch(() => null);
    if (pub) publications.push({ file: clip.file, publication: pub });
  }
  return {
    jobId: job.id,
    videoId: job.videoId,
    title: job.title,
    stage: job.stage,
    message: job.message,
    duration: job.duration,
    format: job.format ?? defaultFormat,
    studioUrl: `${STUDIO_ORIGIN}/?job=${job.id}`,
    sourcePath,
    transcriptSegments: transcript?.segments?.length ?? 0,
    transcriptLanguage: transcript?.language ?? null,
    candidates: candidates ?? job.candidates ?? [],
    clips: (job.clips ?? []).map((clip) => ({
      ...clip,
      filePath: join(directory, clip.file),
      mediaUrl: `${STUDIO_ORIGIN}/media/${job.id}/${clip.file}`,
    })),
    publications,
  };
}

async function handlePrepareVideo(args) {
  const rawUrl = typeof args?.url === 'string' ? args.url.trim() : '';
  const source = youtubeMod.parseVideoSource(rawUrl)
    ?? (/^[\w-]{11}$/.test(rawUrl) ? youtubeMod.sourceFromJob(rawUrl) : null);
  if (!source || !source.videoId) {
    throw new Error('Enlace inválido. Pasa una URL de YouTube o de Twitch (vídeo, clip o canal en directo).');
  }
  const { videoId } = source;
  const format = normalizeFormat(args?.format ?? defaultFormat);

  let job = args?.jobId ? await getJob(args.jobId) : null;
  let sourcePath = job ? await getSourceFile(job.id) : null;
  let cachedFrom = null;

  if (!job) {
    const cached = source.kind === 'live' ? null : await findCachedSourceByVideoId(videoId);
    const defaultTitle = source.platform === 'twitch' ? 'Directo o vídeo de Twitch' : 'Vídeo de YouTube';
    job = {
      id: randomUUID(),
      videoId,
      url: source.url,
      sourcePlatform: source.platform,
      sourceKind: source.kind,
      title: cached?.title || defaultTitle,
      stage: cached ? 'loading' : 'downloading',
      message: cached
        ? 'Fuente 2K recuperada desde caché local para el agente MCP.'
        : (source.kind === 'live' ? 'Capturando directo de Twitch desde 00:00 hasta ahora…' : 'Descargando vídeo maestro…'),
      provider: 'agent',
      engineLabel: 'MCP Agent Orchestrator',
      format,
      sourceReady: Boolean(cached),
      clips: [],
    };
    const directory = jobDirectory(job);
    await mkdir(directory, { recursive: true });
    if (cached) {
      cachedFrom = cached.dir;
      await linkOrCopy(join(cached.dir, cached.sourceName), join(directory, cached.sourceName));
      await linkOrCopy(join(cached.dir, 'transcript.json'), join(directory, 'transcript.json')).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
      sourcePath = join(directory, cached.sourceName);
    }
    await saveJobRecord(job);
  }

  const directory = jobDirectory(job);
  if (!sourcePath) {
    job.stage = 'downloading';
    job.message = source.kind === 'live'
      ? 'Descargando directo de Twitch desde el inicio hasta este momento…'
      : 'Descargando vídeo maestro hasta 2K para agente MCP…';
    await saveJobRecord(job);
    const downloaded = await downloadVideo(source, directory, {});
    sourcePath = downloaded.path;
    job.title = downloaded.title || job.title;
    job.sourceReady = true;
    if (downloaded.isLiveSnapshot) job.isLiveSnapshot = true;
    await saveJobRecord(job);
  }

  const media = await probeVideo(sourcePath);
  if (!media.audio) throw new Error('El vídeo descargado no contiene pista de audio para transcripción.');

  let transcript = args?.retranscribe ? null : await readCheckpoint(directory, 'transcript.json');
  if (!transcript) {
    job.stage = 'transcribing';
    job.message = 'Transcribiendo con Whisper GPU y analizando energía acústica…';
    await saveJobRecord(job);
    transcript = await transcribeVideo(sourcePath, directory, {});
    transcript = await analyzeAudioSignals(sourcePath, transcript, {});
    await writeAtomicJson(join(directory, 'transcript.json'), transcript);
  } else if (!transcript.segments?.some((seg) => Number.isFinite(seg.energy))) {
    transcript = await analyzeAudioSignals(sourcePath, transcript, {});
    await writeAtomicJson(join(directory, 'transcript.json'), transcript);
  }

  const segments = transcript.segments ?? [];
  const duration = media.duration || segments.at(-1)?.end || 0;
  job.duration = duration;
  job.sourceReady = true;
  job.format = format;
  job.waveform = buildWaveform(segments, duration, 160);
  job.waveformVersion = 2;
  job.stage = 'selecting';
  job.message = 'Transcripción lista. Esperando selección viral del agente MCP…';
  await saveJobRecord(job);

  return {
    jobId: job.id,
    videoId: job.videoId,
    title: job.title,
    studioUrl: `${STUDIO_ORIGIN}/?job=${job.id}`,
    cached: Boolean(cachedFrom),
    sourcePath,
    media,
    language: transcript.language,
    segmentCount: segments.length,
    recommendedNextStep: 'Call studio_read_transcript_window to inspect timestamped speech + energy and pick 3-10 viral clips.',
  };
}

async function handleReadTranscriptWindow(args) {
  const jobId = requireJobId(args);
  const { transcript, job } = await loadAgentJobContext(jobId);
  if (!transcript?.segments?.length) {
    throw new Error(`El proyecto ${jobId} todavía no tiene transcript.json. Ejecuta studio_prepare_video primero.`);
  }
  const all = transcript.segments;
  const maxSegments = Math.max(1, Math.min(250, Number(args?.maxSegments) || 80));
  let startIdx = Math.max(0, Math.min(all.length, Number(args?.offsetSegmentIndex) || 0));
  if (Number.isFinite(args?.startTime)) {
    const found = all.findIndex((seg) => seg.end > args.startTime);
    startIdx = found === -1 ? all.length : found;
  }
  const slice = [];
  for (let i = startIdx; i < all.length && slice.length < maxSegments; i++) {
    const seg = all[i];
    if (Number.isFinite(args?.endTime) && seg.start > args.endTime) break;
    slice.push({
      id: seg.id,
      start: Number(seg.start.toFixed(2)),
      end: Number(seg.end.toFixed(2)),
      energy: seg.energy,
      wps: seg.wps,
      pauseBefore: seg.pauseBefore,
      text: seg.text,
    });
  }
  const nextOffset = startIdx + slice.length;
  return {
    jobId,
    title: job.title,
    language: transcript.language,
    totalSegments: all.length,
    duration: job.duration,
    offsetSegmentIndex: startIdx,
    returnedSegments: slice.length,
    hasMore: nextOffset < all.length,
    nextOffsetSegmentIndex: nextOffset < all.length ? nextOffset : null,
    segments: slice,
  };
}

async function handleSaveCandidates(args) {
  const jobId = requireJobId(args);
  const { job, directory, sourcePath, transcript } = await loadAgentJobContext(jobId);
  if (!transcript?.segments?.length) throw new Error('Falta transcript.json.');
  const media = sourcePath ? await probeVideo(sourcePath) : { duration: job.duration || 0 };
  const duration = media.duration || job.duration || transcript.segments.at(-1)?.end || 0;

  const validated = buildAgentCandidates(args?.clips ?? [], transcript.segments, duration);
  if (!validated.length) {
    throw new Error('Ninguno de los clips propuestos superó la validación de duración (8s–90s) o segmentos válidos.');
  }

  await writeAtomicJson(join(directory, 'candidates.json'), validated);
  const format = job.format ?? defaultFormat;
  job.candidates = validated.map((clip, index) => ({
    index: index + 1,
    expectedFile: `clip-${index + 1}.mp4`,
    start: clip.start,
    end: clip.end,
    title: clip.title,
    onScreenHook: clip.onScreenHook,
    category: clip.category,
    score: clip.score,
    viralScores: clip.viralScores,
    peakEnergy: clip.peakEnergy,
    reason: clip.reason,
    ratio: format.ratio,
  }));
  job.stage = 'framing';
  job.message = `${validated.length} cortes guardados por el agente. Analizando fotogramas y encuadres…`;
  await saveJobRecord(job);

  return {
    jobId,
    savedCount: validated.length,
    candidates: job.candidates,
    recommendedNextStep: 'Call studio_analyze_clip_frames for each clipIndex, inspect key .jpg frame paths with read_file if needed, then call studio_render_clip.',
  };
}

async function handleAnalyzeClipFrames(args) {
  const jobId = requireJobId(args);
  const { job, directory, sourcePath, candidates } = await loadAgentJobContext(jobId);
  if (!sourcePath) throw new Error('No se encontró el vídeo fuente.');
  const clipIndex = parseClipIndex(args, candidates);
  const clip = candidates[clipIndex - 1];
  const format = job.format ?? defaultFormat;
  const media = await probeVideo(sourcePath);

  job.stage = 'framing';
  job.activeFramingClip = {
    index: clipIndex,
    start: clip.start,
    end: clip.end,
    title: clip.title,
    stage: 'scanning',
    ratio: format.ratio,
  };
  job.message = `Extrayendo fotogramas y ejecutando visión GPU para clip ${clipIndex}/${candidates.length}…`;
  await saveJobRecord(job);

  const rawFrames = await sampleFrames(sourcePath, directory, clip, clipIndex, {});
  const frameDir = join(directory, 'frames');
  await mkdir(frameDir, { recursive: true });
  const exportedFrames = [];
  for (const frame of rawFrames) {
    const filePath = join(frameDir, `clip-${clipIndex}-f${frame.index}.jpg`);
    await writeFile(filePath, Buffer.from(frame.image, 'base64'));
    exportedFrames.push({ index: frame.index, offset: Number(frame.offset.toFixed(2)), path: filePath });
  }

  const worker = getSharedWorker();
  const sceneData = await analyzeClipScene(rawFrames, { worker });
  const suggestedFraming = cvFramingPlan(rawFrames, format, media, sceneData);
  await writeAtomicJson(join(frameDir, `clip-${clipIndex}-analysis.json`), {
    media,
    scene: sceneData?.scene ?? null,
    inset: sceneData?.inset ?? null,
    frames: sceneData?.frames ?? [],
    suggestedFraming,
  });

  return {
    jobId,
    clipIndex,
    clip: { start: clip.start, end: clip.end, title: clip.title, onScreenHook: clip.onScreenHook },
    media,
    frames: exportedFrames,
    sceneSummary: {
      scene: sceneData?.scene ?? null,
      inset: sceneData?.inset ?? null,
      frames: (sceneData?.frames ?? []).map((f) => ({
        index: f.index,
        sceneType: f.sceneType,
        sceneConfidence: f.sceneConfidence,
        cutBefore: f.cutBefore,
        cameraBox: f.cameraBox,
        actionBox: f.actionBox,
        faces: (f.faces ?? []).slice(0, 3),
      })),
    },
    suggestedFraming,
    tip: 'You can inspect any exported .jpg path with read_file to visually verify the camera/person/gameplay, then pass your chosen layout/boxes (or omit framing to accept suggestedFraming) into studio_render_clip.',
  };
}

async function handleRenderClip(args) {
  const jobId = requireJobId(args);
  const { job, directory, sourcePath, transcript, candidates } = await loadAgentJobContext(jobId);
  if (!sourcePath || !transcript?.segments?.length) throw new Error('Faltan fuente o transcripción.');
  const clipIndex = parseClipIndex(args, candidates);
  const clip = { ...candidates[clipIndex - 1] };
  if (typeof args?.title === 'string' && args.title.trim()) clip.title = args.title.trim().slice(0, 120);
  if (typeof args?.onScreenHook === 'string' && args.onScreenHook.trim()) {
    clip.onScreenHook = args.onScreenHook.trim().slice(0, 72);
  }
  candidates[clipIndex - 1] = clip;
  await writeAtomicJson(join(directory, 'candidates.json'), candidates);

  const format = job.format ?? defaultFormat;
  const media = await probeVideo(sourcePath);
  const cachedAnalysis = await readCheckpoint(join(directory, 'frames'), `clip-${clipIndex}-analysis.json`);

  let frames = cachedAnalysis?.frames?.map((f) => ({ index: f.index, offset: (clip.end - clip.start) * (f.index / Math.max(1, cachedAnalysis.frames.length - 1)) }));
  let sceneData = cachedAnalysis;
  if (!sceneData) {
    const rawFrames = await sampleFrames(sourcePath, directory, clip, clipIndex, {});
    const worker = getSharedWorker();
    sceneData = await analyzeClipScene(rawFrames, { worker });
    frames = rawFrames;
  }

  const framing = buildAgentFramingPlan(frames, format, media, args?.framing ?? null, sceneData);
  if (job.candidates?.[clipIndex - 1]) {
    Object.assign(job.candidates[clipIndex - 1], { title: clip.title, onScreenHook: clip.onScreenHook, framing });
  }
  job.stage = 'rendering';
  job.activeFramingClip = { index: clipIndex, start: clip.start, end: clip.end, title: clip.title, stage: 'framing-locked', ratio: format.ratio, framing };
  job.message = `Renderizando clip ${clipIndex}/${candidates.length} (${framing.layout}) con subtítulos cinéticos…`;
  await saveJobRecord(job);

  const file = await renderClip(sourcePath, directory, clip, transcript, framing, clipIndex, format, { aspect: media.aspect });
  const exportedClip = { ...clip, file, framing, ratio: format.ratio, index: clipIndex };
  const nextClips = [...(job.clips ?? []).filter((c) => c.file !== file), exportedClip].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  job.clips = nextClips;
  job.lastExportedClip = { index: clipIndex, start: clip.start, end: clip.end, title: clip.title, ratio: format.ratio, framing, exportedAt: Date.now() };
  job.activeFramingClip = { index: clipIndex, start: clip.start, end: clip.end, title: clip.title, stage: 'exported', ratio: format.ratio, framing };
  job.message = `Clip ${clipIndex}/${candidates.length} exportado (${file}).`;
  await saveJobRecord(job);

  return {
    jobId,
    clipIndex,
    file,
    path: join(directory, file),
    mediaUrl: `${STUDIO_ORIGIN}/media/${jobId}/${file}`,
    framing,
  };
}

async function handleSaveSeoPackage(args) {
  const jobId = requireJobId(args);
  const { job, directory, candidates } = await loadAgentJobContext(jobId);
  const clipIndex = parseClipIndex(args, candidates?.length ? candidates : job.clips);
  const clipFile = `clip-${clipIndex}.mp4`;
  const clip = candidates?.[clipIndex - 1] ?? job.clips?.find((c) => c.file === clipFile) ?? {};
  const saved = await saveAgentSeoSuggestion(directory, clipFile, args?.seo ?? {}, { sourceTitle: job.title, clip });
  return { jobId, clipIndex, clipFile, seo: saved };
}

async function handleFinishProject(args) {
  const jobId = requireJobId(args);
  const { job } = await loadAgentJobContext(jobId);
  await closeSharedWorker();
  delete job.activeFramingClip;
  job.stage = 'done';
  job.message = `Listos ${job.clips?.length ?? 0} clips virales editados por el agente MCP.`;
  await saveJobRecord(job);
  return {
    jobId,
    stage: job.stage,
    title: job.title,
    studioUrl: `${STUDIO_ORIGIN}/?job=${jobId}`,
    clipsCount: job.clips?.length ?? 0,
    clips: (job.clips ?? []).map((c) => ({
      index: c.index,
      file: c.file,
      title: c.title,
      layout: c.framing?.layout,
      mediaUrl: `${STUDIO_ORIGIN}/media/${jobId}/${c.file}`,
    })),
  };
}

async function handleUploadYouTubeBatch(args) {
  const jobId = requireJobId(args);
  return uploadProjectToYouTube(jobId, {
    intervalHours: Number.isFinite(args?.intervalHours) ? args.intervalHours : 1,
    startAtIso: typeof args?.startAtIso === 'string' && args.startAtIso.trim() ? args.startAtIso.trim() : undefined,
    maxClips: Number.isInteger(args?.maxClips) ? args.maxClips : undefined,
  });
}

const TOOL_HANDLERS = {
  studio_inspect_formats: handleInspectFormats,
  studio_list_projects: handleListProjects,
  studio_get_project: handleGetProject,
  studio_prepare_video: handlePrepareVideo,
  studio_read_transcript_window: handleReadTranscriptWindow,
  studio_save_candidates: handleSaveCandidates,
  studio_analyze_clip_frames: handleAnalyzeClipFrames,
  studio_render_clip: handleRenderClip,
  studio_save_seo_package: handleSaveSeoPackage,
  studio_finish_project: handleFinishProject,
  studio_upload_youtube_batch: handleUploadYouTubeBatch,
};

async function handleRpcMessage(rawLine) {
  let msg;
  try {
    msg = JSON.parse(rawLine);
  } catch {
    return writeError(null, -32700, 'JSON inválido.');
  }
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      return writeResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return;
    }
    if (method === 'ping') {
      return writeResult(id, {});
    }
    if (method === 'tools/list') {
      return writeResult(id, { tools: TOOL_DEFINITIONS });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        return writeResult(id, {
          content: [{ type: 'text', text: `Herramienta desconocida: ${String(name)}` }],
          isError: true,
        });
      }
      try {
        const result = await handler(params?.arguments ?? {});
        return writeResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (toolError) {
        return writeResult(id, {
          content: [{ type: 'text', text: toolError?.message || String(toolError) }],
          isError: true,
        });
      }
    }
    if (!isNotification) {
      writeError(id, -32601, `Método MCP no soportado: ${String(method)}`);
    }
  } catch (err) {
    if (!isNotification) {
      writeError(id, -32603, err?.message || 'Error interno en Corte Studio MCP.');
    }
  }
}

export function startMcpStdioServer() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const queue = [];
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const line = queue.shift();
      await handleRpcMessage(line);
    }
    running = false;
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    queue.push(trimmed);
    void drain();
  });

  const shutdown = async () => {
    await closeSharedWorker();
    process.exit(0);
  };
  rl.on('close', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpStdioServer();
}
