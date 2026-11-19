import { randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import youtube from '../dist/youtube.js';
import { chooseClips, chooseFraming, refineGameplayHook, refinePrototypeCopy } from './analysis.mjs';
import { RequestError } from './errors.mjs';
import { geminiJson } from './gemini.mjs';
import { abortLlamaProcesses, startLlama } from './llama.mjs';
import { abortMediaProcesses, analyzeAudioSignals, analyzeClipScene, cancelError, dataDir, downloadVideo, probeVideo, auditClip, fetchChatSpikes, renderClip, renderPrototypeClip, renderSummaryVideo, sampleFrames, startVisionWorker, transcribeVideo } from './media.mjs';
import { openRouterJson } from './openrouter.mjs';
import { generatePublicationSuggestions, inferGameContext, savePublicationDraft } from './publication.mjs';
import { SUMMARY_VERSION, chapterListing, formatTimestamp, planSummary, resolveSummaryTarget } from './summary.mjs';
import { defaultFormat, normalizeFormat } from './formats.mjs';
import { refineSpeakerFraming } from './asd.mjs';
import { getBrand } from './brands.mjs';
import { renameWithRetry } from './fsx.mjs';
import { exportJobClips } from './export.mjs';

const jobsDir = join(dataDir, 'jobs');
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
let active = null;
let activeController = null;
let activeExecution = Promise.resolve();
const jobListeners = new Set();

const relativePath = (job) => join(jobsDir, job.id);

export function subscribeJobEvents(listener) {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}

function notifyJobListeners(job) {
  for (const listener of jobListeners) {
    try { listener(job); } catch { /* Ignore closed event listeners. */ }
  }
}

async function save(job) {
  const path = relativePath(job);
  await writeFile(join(path, 'job.tmp'), JSON.stringify(job, null, 2), 'utf8');
  await renameWithRetry(join(path, 'job.tmp'), join(path, 'job.json'));
}

async function report(job, stage, message) {
  job.stage = stage;
  job.message = message;
  await save(job);
  notifyJobListeners(job);
}

async function readCheckpoint(directory, name) {
  try {
    return JSON.parse(await readFile(join(directory, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function buildWaveform(segments, duration, bars = 160) {
  if (!Array.isArray(segments) || !segments.length || !Number.isFinite(duration) || duration <= 0) return [];
  const binDur = duration / bars;
  const raw = new Array(bars).fill(0);
  for (const segment of segments) {
    const start = Math.max(0, Number(segment.start) || 0);
    const end = Math.min(duration, Number(segment.end) || start);
    if (end <= start) continue;
    const segDur = Math.max(0.25, end - start);
    const words = segment.text ? segment.text.trim().split(/\s+/).length : 2;
    const wps = Number.isFinite(segment.wps) ? segment.wps : (words / segDur);
    const energy = Number.isFinite(segment.energy) ? segment.energy : (3.2 + Math.min(6.2, wps * 1.35));
    const accent = /[!?¡¿]/.test(segment.text || '') ? 1.15 : 1;
    const intensity = (energy * 0.72 + Math.min(6, wps) * 1.15) * accent;
    const startIdx = Math.max(0, Math.floor(start / binDur));
    const endIdx = Math.min(bars - 1, Math.floor(end / binDur));
    for (let i = startIdx; i <= endIdx; i++) {
      const binStart = i * binDur;
      const binEnd = binStart + binDur;
      const overlap = Math.max(0, Math.min(binEnd, end) - Math.max(binStart, start));
      if (overlap > 0) raw[i] += (overlap / binDur) * intensity;
    }
  }
  const active = raw.filter((v) => v > 0.01);
  if (!active.length) return raw.map((_, i) => 8 + Math.round(Math.abs(Math.sin(i * 0.7)) * 6));
  const sorted = [...active].sort((a, b) => a - b);
  const minVal = sorted[0];
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const spread = Math.max(1e-4, p98 - minVal);
  return raw.map((val, i) => {
    if (val <= 0.01) return 6 + Math.round(Math.abs(Math.sin(i * 0.85)) * 5);
    const norm = Math.max(0, Math.min(1.06, (val - minVal) / spread));
    const curved = Math.pow(Math.min(1, norm), 1.55);
    const mod = 0.88 + 0.12 * Math.sin(i * 1.7 + val * 2.9);
    return Math.max(10, Math.min(100, Math.round(10 + curved * 90 * mod)));
  });
}

export async function openJobInference(engine, directory, { signal } = {}) {
  if (!engine) return { infer: null, close: async () => {} };
  let runtime = null;
  if (engine.provider === 'local' && engine.model) {
    runtime = await startLlama(engine.model, directory, { signal });
  }
  const infer = runtime?.infer ?? (engine.provider === 'openrouter'
    ? ((request) => openRouterJson(engine.key, { ...request, model: engine.model?.id, signal }))
    : ((request) => geminiJson(engine.key, { ...request, signal })));
  return { infer, close: () => runtime?.close?.() ?? Promise.resolve() };
}

export const summaryFormat = normalizeFormat({ ratio: '16:9', layouts: ['fit'], fitCrop: 'original', contentCrop: 'auto' });

export function summaryOptionsFrom(input = {}) {
  const minutes = Number(input?.targetMinutes);
  return {
    targetMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 120 ? Math.round(minutes) : 0,
    captions: input?.captions !== false,
  };
}

// Modo Resumen: un único vídeo largo (clip-1.mp4) con lo más importante del original.
async function processSummary(source, directory, engine, update, { media, transcript, completed, sourceTitle, sourceChannel, options, signal }) {
  const checkCancelled = () => { if (signal?.aborted) throw cancelError(); };
  if (completed > 0) return;
  const target = resolveSummaryTarget(media.duration, options.targetMinutes);
  const planFile = `summary-plan-${target}-v${SUMMARY_VERSION}.json`;
  let plan = await readCheckpoint(directory, planFile);
  const toMeta = (value) => ({
    targetSeconds: value.targetSeconds, outputSeconds: value.outputSeconds, sourceSeconds: value.sourceSeconds,
    beatCount: value.beatCount, cardCount: value.cardCount, partCount: value.parts.length,
    title: value.title, description: value.description,
    // [inicio origen, fin origen, tipo de tarjeta o 0, inicio en el resumen]
    parts: value.parts.map(({ start, end, card, outStart }) => [start, end, card?.kind ?? 0, outStart]),
    chapters: value.chapters.map(({ title, outStart }) => ({
      title, outStart, sourceStart: value.parts.findLast((part) => part.outStart <= outStart + 0.01)?.start ?? 0,
    })),
    cards: value.parts.filter((part) => part.card).map((part) => ({
      kind: part.card.kind, text: part.card.text, outStart: part.outStart, sourceStart: part.start,
    })),
  });
  if (!plan) {
    const signals = await analyzeAudioSignals(source, transcript, { signal });
    const waveform = buildWaveform(signals.segments, media.duration, 160);
    await update('loading', 'Preparando el resumen…', undefined, { sourceReady: true, duration: media.duration, waveform, waveformVersion: 2, segmentCount: transcript.segments.length });
    const inference = await openJobInference(engine, directory, { signal });
    try {
      checkCancelled();
      plan = await planSummary(inference.infer, signals, media, (message) => update('selecting', message),
        { target, sourceTitle, sourceChannel, local: Boolean(engine.provider === 'local' && engine.model) });
    } finally {
      await inference.close();
    }
    checkCancelled();
    await writeFile(join(directory, 'summary-plan.tmp'), JSON.stringify(plan), 'utf8');
    await renameWithRetry(join(directory, 'summary-plan.tmp'), join(directory, planFile));
  }
  const first = plan.parts[0];
  const last = plan.parts.at(-1);
  const candidate = {
    index: 1, expectedFile: 'clip-1.mp4', start: first.start, end: last.end, title: plan.title,
    category: 'resumen', reason: plan.description, ratio: summaryFormat.ratio,
  };
  await update('selecting', `Resumen planificado: ${formatTimestamp(plan.outputSeconds)} de ${formatTimestamp(plan.sourceSeconds)}.`, undefined, {
    candidates: [candidate], summary: toMeta(plan),
  });
  checkCancelled();
  await update('rendering', `Montando el resumen (0 de ${plan.parts.length} tramos)…`, undefined, {
    summaryProgress: { done: 0, total: plan.parts.length },
  });
  let lastReport = 0;
  const file = await renderSummaryVideo(source, directory, plan, transcript, summaryFormat, {
    captions: options.captions, clipNumber: 1, signal,
    onProgress: async ({ done, total }) => {
      const now = Date.now();
      if (done < total && now - lastReport < 1500) return;
      lastReport = now;
      await update('rendering', `Montando el resumen (${done} de ${total} tramos)…`, undefined, { summaryProgress: { done, total } });
    },
  });
  const exportedClip = {
    ...candidate, file, framing: { layout: 'fit', mode: 'fit' }, longForm: true, summary: true,
    duration: plan.outputSeconds,
  };
  await update('rendering', 'Resumen exportado.', exportedClip, { summaryProgress: null, candidates: [candidate] });
  const listing = plan.chapters.length ? `\n\nCapítulos:\n${chapterListing(plan.chapters)}` : '';
  await savePublicationDraft(directory, exportedClip, {
    platform: 'youtube', title: plan.title.slice(0, 100),
    text: `${plan.description || plan.title}${listing}`.slice(0, 1200), hashtags: [],
  }).catch((error) => console.warn('No se pudo guardar el borrador de publicación del resumen:', error.message));
}

// Analyse a normal file once import has finished. This is also the path used to validate the renderer on sample footage.
const candidatesFile = (search) => search ? `candidates-${search.id}.json` : 'candidates.json';

function clipCandidate(clip, index, expectedFile) {
  return { ...clip, index, expectedFile };
}

export async function processVideo(source, directory, engine, update, { completed = 0, search, sourceTitle = 'Vídeo de YouTube', sourceChannel, format = defaultFormat, mode = 'normal', voice = 'piper:es_ES-davefx-medium', summaryOptions, brandId, chatUrl, signal } = {}) {
  const brand = await getBrand(brandId);
  const checkCancelled = () => { if (signal?.aborted) throw cancelError(); };
  checkCancelled();
  const media = await probeVideo(source);
  if (!media.audio) return;
  let transcript = await readCheckpoint(directory, 'transcript.json');
  if (!transcript) {
    if (search) throw new RequestError(409, 'Este proyecto ya no tiene su transcripción guardada.');
    await update('transcribing', 'Transcribiendo el audio con Whisper en GPU…', undefined, { sourceReady: true, duration: media.duration });
    transcript = await transcribeVideo(source, directory, { signal });
  } else {
    await update(search ? 'selecting' : 'loading', 'Transcripción recuperada. Preparando análisis…', undefined, { sourceReady: true, duration: media.duration });
  }
  checkCancelled();
  if (!transcript.segments.length) return;
  // Picos del chat de directos de YouTube que conservan su chat: se anotan como chatSpike en la transcripción.
  if (chatUrl && !search) {
    const chat = await fetchChatSpikes(chatUrl, directory, { signal });
    if (chat?.annotated) transcript = await readCheckpoint(directory, 'transcript.json');
  }
  if (mode === 'summary') {
    return processSummary(source, directory, engine, update, { media, transcript, completed, sourceTitle, sourceChannel, options: summaryOptionsFrom(summaryOptions), signal });
  }
  const checkpoint = candidatesFile(search);
  let candidates = await readCheckpoint(directory, checkpoint);
  if (candidates && !candidates.length) return;
  const savedClips = search || completed ? (await readCheckpoint(directory, 'job.json'))?.clips ?? [] : [];
  const previousClips = search ? savedClips.slice(0, search.previousCount) : [];
  const previousCount = previousClips.length;
  const firstNumber = search?.firstNumber ?? 1;

  let jobInference = null;
  try {
    const preSignals = await analyzeAudioSignals(source, transcript, { signal });
    const waveform = buildWaveform(preSignals.segments, media.duration, 160);
    const transcriptMeta = { sourceReady: true, duration: media.duration, waveform, waveformVersion: 2, segmentCount: transcript.segments.length };
    if (engine.provider === 'local' && engine.model) {
      await update(search ? 'selecting' : 'loading', `Cargando ${engine.model.label} en llama.cpp…`, undefined, transcriptMeta);
    } else {
      await update(search ? 'selecting' : 'loading', 'Preparando análisis de momentos virales…', undefined, transcriptMeta);
    }
    jobInference = await openJobInference(engine, directory, { signal });
    const infer = jobInference.infer;
    checkCancelled();
    if (!candidates) {
      await update('selecting', search ? 'Buscando momentos fuera de los tramos ya exportados…'
        : (mode === 'prototype' ? 'Seleccionando momentos ≤30s y guion de locutor…' : 'Midiendo energía y ritmo del audio…'));
      checkCancelled();
      candidates = await chooseClips(infer, preSignals, media, (message) => update('selecting', message),
        Boolean(engine.provider === 'local' && engine.model), { sourceTitle, sourceChannel, mode, exclude: previousClips });
      checkCancelled();
      await writeFile(join(directory, 'candidates.tmp'), JSON.stringify(candidates), 'utf8');
      await renameWithRetry(join(directory, 'candidates.tmp'), join(directory, checkpoint));
    }
    if (!candidates.length) return;
    const candidateItems = [
      ...previousClips.map((clip, index) => clipCandidate(clip, index + 1, clip.file)),
      ...candidates.map((clip, index) => clipCandidate(
        { ...clip, ratio: format.ratio, ...savedClips[previousCount + index] },
        previousCount + index + 1, `clip-${firstNumber + index}.mp4`)),
    ];
    await update('selecting', `Seleccionados ${candidates.length} cortes virales. Marcando tramos en la línea de tiempo…`, undefined, { candidates: candidateItems });
    const inferVision = async (request) => {
      try {
        return await infer(request);
      } catch (error) {
        if (error?.code === 'CANCELLED' || signal?.aborted) throw cancelError();
        if (error?.status === 429 || error?.status === 502 || error?.status === 403 || error?.retryable) {
          console.warn(`Visión remota omitida en encuadre (${error.message}). Usando OpenCV inteligente.`);
          return null;
        }
        throw error;
      }
    };
    const visionWorker = candidates.length > completed ? startVisionWorker({ signal }) : null;
    try {
      for (const [index, candidate] of candidates.entries()) {
        checkCancelled();
        if (index < completed) continue;
        let clip = candidate;
        const clipNumber = firstNumber + index;
        const itemIndex = previousCount + index;
        const displayIndex = itemIndex + 1;
        const progression = `${index + 1} de ${candidates.length}`;
        await update('framing', `Escaneando encuadre inteligente del clip ${progression}…`, undefined, {
          activeFramingClip: { index: displayIndex, start: clip.start, end: clip.end, title: clip.title, stage: 'scanning', ratio: format.ratio },
        });
        const frames = await sampleFrames(source, directory, clip, clipNumber, { signal });
        const sceneData = await analyzeClipScene(frames, { signal, worker: visionWorker });
        let framing = await chooseFraming(inferVision, clip, frames, transcript, media, format, null, sceneData, { mode });
        if (mode !== 'prototype') {
          framing = await refineSpeakerFraming({ source, directory, clip, clipNumber, framing, sceneData, transcript, format, media, signal });
        }
        const gameplay = sceneData?.inset?.kind === 'gameplay' || inferGameContext(sourceTitle, { ...clip, framing });
        if (mode === 'prototype' || gameplay) {
          const refineCopy = mode === 'prototype' ? refinePrototypeCopy : refineGameplayHook;
          const copy = await refineCopy(inferVision, clip, frames, transcript, sourceTitle, sourceChannel).catch((error) => {
            if (signal?.aborted || error.code === 'CANCELLED' || mode === 'prototype') throw error;
            console.warn('Se conserva el rótulo inicial del gameplay:', error.message);
            return {};
          });
          clip = { ...clip, ...copy };
          Object.assign(candidateItems[itemIndex], copy);
        }
        checkCancelled();
        candidateItems[itemIndex].framing = framing;
        await update('rendering', mode === 'prototype' ? `Montando gancho, voz, pausa y efectos de sonido (${progression})…` : `Aplicando recorte ${framing.layout} y renderizando clip ${progression}…`, undefined, {
          activeFramingClip: { index: displayIndex, start: clip.start, end: clip.end, title: clip.title, stage: 'framing-locked', ratio: format.ratio, framing },
          candidates: candidateItems,
        });
        const fx = {};
        const file = mode === 'prototype'
          ? await renderPrototypeClip(source, directory, clip, transcript, framing, clipNumber, format, {
              aspect: media.aspect, voice, signal, audioSegments: preSignals.segments, brand,
            })
          : await renderClip(source, directory, clip, transcript, framing, clipNumber, format, { aspect: media.aspect, brand, audioSegments: preSignals.segments, report: fx, signal });
        const audit = mode === 'prototype' ? null : await auditClip(join(directory, file), { assPath: join(directory, file.replace(/\.mp4$/, '.ass')), format, signal }).catch((error) => {
          if (error?.code === 'CANCELLED') throw error;
          return null;
        });
        const exportedClip = { ...clip, file, framing, ratio: format.ratio, index: displayIndex, ...(audit ? { audit } : {}), ...(Object.keys(fx).length ? { fx } : {}) };
        await update('rendering', `Clip ${progression} exportado.`, exportedClip, {
          activeFramingClip: { index: displayIndex, start: clip.start, end: clip.end, title: clip.title, stage: 'exported', ratio: format.ratio, framing },
          lastExportedClip: { index: displayIndex, start: clip.start, end: clip.end, title: clip.title, ratio: format.ratio, framing, exportedAt: Date.now() },
          candidates: candidateItems,
        });
      }
    } finally {
      await visionWorker?.close();
    }
    await update('rendering', 'Encuadre y render completados.', undefined, { activeFramingClip: null });
    if (candidates.length) {
      checkCancelled();
      await update('editorial', 'Analizando cada clip 1 a 1 para generar SEO profesional…');
      const clips = candidateItems.slice(previousCount).map((clip) => ({ ...clip, file: clip.expectedFile }));
      await generatePublicationSuggestions(infer, directory, sourceTitle, transcript, clips, { signal, brand }).catch((error) => {
        if (error?.code === 'CANCELLED' || signal?.aborted) throw cancelError();
        console.warn('El motor no completó todas las sugerencias de publicación. Los recortes están disponibles.');
      });
    }
  } finally {
    await jobInference?.close();
  }
}

async function execute(job, engine, storedSource, controller) {
  const { signal } = controller;
  try {
    const directory = relativePath(job);
    let source = storedSource;
    if (!source) {
      job.downloadProgress = { percent: 0, speed: 'Conectando…', downloaded: '0 MB', eta: '—' };
      await report(job, 'downloading', 'Iniciando descarga turbo multiconexión…');
      const downloaded = await downloadVideo(job.url || job.videoId, directory, {
        signal,
        onProgress: (progress) => {
          job.downloadProgress = progress;
          job.message = `Extrayendo stream rápido (${progress.percent}% · ${progress.speed})…`;
          notifyJobListeners(job);
        },
      });
      source = downloaded.path;
      job.title = downloaded.title;
      if (downloaded.channel) job.sourceChannel = downloaded.channel;
      job.sourceReady = true;
      if (downloaded.isLiveSnapshot) job.isLiveSnapshot = true;
      job.downloadProgress = { percent: 100, speed: 'Completado', downloaded: 'Maestro listo', eta: '0s' };
      await report(job, 'downloading', 'Vídeo maestro codificado. Iniciando motor de audio…');
    } else {
      job.sourceReady = true;
      await report(job, job.stage || 'loading', job.message || 'Vídeo maestro listo desde caché local.');
    }
    await processVideo(source, directory, engine, (stage, message, clip, meta) => {
      if (signal.aborted) throw cancelError();
      if (meta) Object.assign(job, meta);
      if (clip) job.clips.push(clip);
      return report(job, stage, message);
    }, { completed: job.clips.length - (job.clipSearch?.previousCount ?? 0), search: job.clipSearch,
      sourceTitle: job.title, sourceChannel: job.sourceChannel, format: job.format, mode: job.mode || 'normal', voice: job.voice || 'piper:es_ES-davefx-medium', summaryOptions: job.summaryOptions, brandId: job.brandId,
      chatUrl: job.sourcePlatform === 'youtube' && job.sourceKind === 'video' ? job.url : null, signal });
    if (signal.aborted) throw cancelError();
    delete job.activeFramingClip;
    job.canResume = false;
    job.canSearchMore = job.mode !== 'summary' && Boolean(job.sourceReady && job.segmentCount);
    job.resumeStep = 5;
    const newClips = job.clips.length - (job.clipSearch?.previousCount ?? 0);
    const message = job.clipSearch
      ? (newClips ? `Se añadieron ${newClips} clips nuevos al proyecto.` : 'No se encontraron más momentos recomendados fuera de los clips anteriores.')
      : (job.mode === 'summary' && job.clips.length ? `Resumen listo: ${formatTimestamp(job.summary?.outputSeconds ?? 0)} a partir de ${formatTimestamp(job.summary?.sourceSeconds ?? 0)}.`
      : job.clips.length ? 'Clips listos para revisar y descargar.' : 'El vídeo no contiene un corte de voz que el editor recomiende exportar.');
    const copied = await exportJobClips(job).catch((error) => {
      console.warn('No se pudieron copiar los vídeos a la carpeta de Descargas:', error.message);
      return null;
    });
    if (copied?.folder) job.exportFolder = copied.folder;
    await report(job, 'done', message);
  } catch (error) {
    const cancelled = signal.aborted || error.code === 'CANCELLED';
    if (!cancelled && !error.status) console.error('Error interno procesando el proyecto:', error);
    job.code = cancelled ? 'CANCELLED' : error.code;
    delete job.activeFramingClip;
    const progress = await inspectSavedProgress(job.id, job).catch(() => null);
    if (progress) {
      job.resumeStep = progress.resumeStep;
      job.remainingClips = progress.remainingClips;
    }
    job.canResume = true;
    const message = cancelled
      ? 'Análisis detenido por el usuario. Fases completadas guardadas.'
      : (error.status ? error.message : `El procesamiento se interrumpió en la etapa ${job.stage}. Pulsa Terminar vídeo para continuar.`);
    await report(job, 'error', message).catch(() => {});
  } finally {
    if (active === job) {
      active = null;
      activeController = null;
    }
  }
}

export const activeJobId = () => active?.id ?? null;

/** Detiene el trabajo si es el activo (por ejemplo antes de borrar su carpeta). */
export async function stopJob(id) {
  if (active?.id !== id) return false;
  await cancelAllJobs();
  return true;
}

export async function cancelAllJobs() {
  const job = active;
  if (activeController && !activeController.signal.aborted) {
    activeController.abort(cancelError());
  }
  abortMediaProcesses();
  abortLlamaProcesses();
  await Promise.race([activeExecution, new Promise((resolve) => setTimeout(resolve, 4000))]);
  if (!job) return { cancelled: false };
  const latest = await getJob(job.id).catch(() => null);
  return { cancelled: true, job: latest ?? job };
}

async function linkOrCopy(sourcePath, targetPath) {
  try {
    await link(sourcePath, targetPath);
  } catch {
    await copyFile(sourcePath, targetPath);
  }
}

async function inspectSavedProgress(id, job) {
  const directory = join(jobsDir, id);
  const files = await readdir(directory).catch(() => []);
  const sourceName = files.find((name) => /^source\.(mkv|mp4|webm|m4v|mov|avi|flv|3gp|ts)$/i.test(name)) ?? null;
  const hasTranscript = files.includes('transcript.json');
  const checkpoint = candidatesFile(job?.clipSearch);
  const hasCandidates = job?.mode === 'summary' ? files.some((name) => /^summary-plan-.*\.json$/.test(name)) : files.includes(checkpoint);
  const savedCandidates = hasCandidates && job?.mode !== 'summary' ? await readCheckpoint(directory, checkpoint).catch(() => null) : null;
  const previousCount = job?.clipSearch?.previousCount ?? 0;
  const totalTargets = Array.isArray(savedCandidates) ? savedCandidates.length : Math.max(0, (job?.candidates?.length ?? 0) - previousCount);
  const exportedClips = (job?.clips?.length ?? 0) - previousCount;
  let resumeStep = 0;
  if (job?.stage === 'done') resumeStep = 5;
  else if (!sourceName) resumeStep = 0;
  else if (!hasTranscript) resumeStep = 1;
  else if (!hasCandidates) resumeStep = 2;
  else if (totalTargets === 0 || exportedClips < totalTargets) resumeStep = 3;
  else resumeStep = 4;
  return {
    sourceName,
    sourcePath: sourceName ? join(directory, sourceName) : null,
    hasTranscript,
    hasCandidates,
    files,
    resumeStep,
    remainingClips: Math.max(0, totalTargets - exportedClips),
  };
}

async function findCachedSourceByVideoId(videoId) {
  const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    const saved = await readCheckpoint(join(jobsDir, entry.name), 'job.json').catch(() => null);
    if (!saved || saved.videoId !== videoId || saved.isLiveSnapshot) continue;
    const sourcePath = await getSourceFile(entry.name).catch(() => null);
    if (!sourcePath) continue;
    return {
      dir: join(jobsDir, entry.name),
      sourcePath,
      sourceName: basename(sourcePath),
      title: saved.title,
      sourceChannel: saved.sourceChannel,
    };
  }
  return null;
}

export async function startJob(sourceOrId, engine, retryJobId, format = defaultFormat, { mode = 'normal', voice = 'piper:es_ES-davefx-medium', summaryOptions, brandId, preloadedDir, preloadedSource } = {}) {
  const source = sourceOrId?.platform === 'local' ? sourceOrId : youtube.sourceFromJob(sourceOrId);
  const videoId = source.videoId;
  const videoMode = ['prototype', 'summary'].includes(mode) ? mode : 'normal';
  const cleanSummary = videoMode === 'summary' ? summaryOptionsFrom(summaryOptions) : undefined;
  if (videoMode === 'summary') format = summaryFormat;
  const matchesFormat = (job) => JSON.stringify(job.format ?? defaultFormat) === JSON.stringify(format);
  const matchesMode = (job) => (job.mode || 'normal') === videoMode;
  const sameRunning = () => active?.videoId === videoId && active.provider === engine.provider && active.modelId === engine.model?.id && matchesFormat(active) && matchesMode(active);
  if (sameRunning()) return active;
  if (active) throw new RequestError(409, 'Ya se está procesando otro vídeo. Espera a que termine antes de continuar.');
  const previous = typeof retryJobId === 'string' ? await getJob(retryJobId) : null;
  let sourceName;
  let sourceDir;
  let cachedTitle;
  let cachedChannel;
  let resume = false;
  if (previous?.videoId === videoId) {
    const files = await readdir(relativePath(previous));
    sourceName = files.find((name) => /^source\.(mkv|mp4|webm|m4v|mov|avi|flv|3gp|ts)$/i.test(name));
    if (sourceName) {
      sourceDir = relativePath(previous);
      cachedTitle = previous.title;
      cachedChannel = previous.sourceChannel;
    }
    const sameEngine = (previous.provider ?? (previous.localModel ? 'local' : 'gemini')) === engine.provider && previous.modelId === engine.model?.id;
    resume = Boolean(sourceName && previous.stage === 'error' && matchesMode(previous) && ((sameEngine && matchesFormat(previous)) || (!previous.clips.length && !files.includes('candidates.json'))));
  }
  if (!sourceName && source.kind !== 'live') {
    const cached = await findCachedSourceByVideoId(videoId);
    if (cached) {
      sourceName = cached.sourceName;
      sourceDir = cached.dir;
      cachedTitle = cached.title;
      cachedChannel = cached.sourceChannel;
    }
  }
  if (sameRunning()) return active;
  if (active) throw new RequestError(409, 'Ya se está procesando otro vídeo. Espera a que termine antes de continuar.');
  const defaultTitle = source.platform === 'local' ? (source.title || 'Vídeo local') : (source.platform === 'twitch' ? 'Directo o vídeo de Twitch' : 'Vídeo de YouTube');
  const job = resume ? { ...previous, code: undefined }
    : {
        id: preloadedDir || randomUUID(),
        videoId,
        url: source.url,
        sourcePlatform: source.platform,
        sourceKind: source.kind,
        title: cachedTitle || defaultTitle,
        ...(cachedChannel ? { sourceChannel: cachedChannel } : {}),
        stage: 'downloading',
        message: source.kind === 'live' ? 'Capturando directo desde el inicio hasta este momento…' : 'Preparando descarga turbo…',
        clips: [],
      };
  Object.assign(job, {
    mode: videoMode,
    ...(videoMode === 'prototype' ? { voice } : {}),
    ...(cleanSummary ? { summaryOptions: cleanSummary } : {}),
    brandId: (await getBrand(brandId)).id,
    provider: engine.provider,
    modelId: engine.model?.id,
    localModel: engine.provider === 'local' ? engine.model?.label : undefined,
    engineLabel: engine.provider === 'openrouter' ? engine.model?.label : undefined,
    format,
  });
  if (sourceName || preloadedSource) {
    job.title = cachedTitle || previous?.title || job.title;
    job.sourceReady = true;
    job.stage = preloadedSource ? 'transcribing' : 'loading';
    job.message = preloadedSource ? 'Archivo local cargado. Iniciando transcripción con Whisper…' : 'Vídeo recuperado al instante desde caché local.';
  }
  active = job;
  const controller = new AbortController();
  activeController = controller;
  try {
    const directory = relativePath(job);
    await mkdir(directory, { recursive: true });
    if (sourceName && sourceDir && !resume) {
      await linkOrCopy(join(sourceDir, sourceName), join(directory, sourceName));
      await linkOrCopy(join(sourceDir, 'transcript.json'), join(directory, 'transcript.json')).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await save(job);
  } catch (error) {
    active = null;
    activeController = null;
    throw error;
  }
  activeExecution = execute(job, engine, preloadedSource || (sourceName ? join(relativePath(job), sourceName) : undefined), controller);
  return job;
}

export async function resumeJob(id, engine, { searchMore = false } = {}) {
  if (!idPattern.test(id)) throw new RequestError(404, 'Este proyecto no existe.');
  if (active?.id === id && !searchMore) return active;
  if (active) throw new RequestError(409, 'Ya se está procesando otro proyecto. Espera a que termine o cancélalo.');
  const existing = await getJob(id);
  if (!existing) throw new RequestError(404, 'Este proyecto ya no está disponible.');
  if (searchMore ? existing.stage !== 'done' : existing.stage === 'done') {
    throw new RequestError(400, searchMore ? 'Termina el proyecto antes de buscar más clips.' : 'Este proyecto ya completó todos sus clips.');
  }

  const progress = await inspectSavedProgress(id, existing);
  const job = { ...existing, code: undefined };
  delete job.activeFramingClip;
  delete job.lastExportedClip;
  delete job.downloadProgress;
  Object.assign(job, {
    provider: engine.provider,
    modelId: engine.model?.id,
    localModel: engine.provider === 'local' ? engine.model?.label : undefined,
    engineLabel: engine.provider === 'openrouter' ? engine.model?.label : undefined,
    canResume: false,
    resumeStep: progress.resumeStep,
    remainingClips: progress.remainingClips,
  });

  if (searchMore) {
    if (!progress.sourcePath || !progress.hasTranscript) {
      throw new RequestError(409, 'Falta el vídeo fuente o la transcripción guardada de este proyecto.');
    }
    const existingFiles = [...progress.files, ...job.clips.map(({ file }) => file)];
    const firstNumber = 1 + existingFiles.reduce((largest, file) => {
      const number = /^clip-(\d+)(?:\.|$)/.exec(file)?.[1];
      return Math.max(largest, Number(number ?? 0));
    }, 0);
    job.clipSearch = { id: randomUUID(), previousCount: job.clips.length, firstNumber };
    job.candidates = job.clips.map((clip, index) => clipCandidate(clip, index + 1, clip.file));
    job.resumeStep = 2;
    job.remainingClips = 0;
    job.stage = 'selecting';
    job.message = 'Fase 03: buscando nuevos momentos fuera de los clips anteriores…';
  } else if (progress.sourcePath) {
    job.sourceReady = true;
    if (!progress.hasTranscript) {
      job.stage = 'transcribing';
      job.message = 'Reanudando en Fase 02: transcripción con Whisper GPU…';
    } else if (!progress.hasCandidates) {
      job.stage = 'selecting';
      job.message = job.mode === 'summary' ? 'Reanudando: eligiendo los pasajes clave del resumen…' : 'Reanudando en Fase 03: selección viral…';
    } else if (job.mode === 'summary') {
      job.stage = 'rendering';
      job.message = 'Reanudando el montaje del resumen con los tramos ya preparados…';
    } else if (progress.resumeStep === 3) {
      job.stage = 'framing';
      job.message = `Reanudando en Fase 04: completando ${progress.remainingClips || 'los'} clips restantes…`;
    } else {
      job.stage = 'editorial';
      job.message = 'Completando fichas de publicación y cierre final…';
    }
  } else {
    job.stage = 'downloading';
    job.message = 'Reanudando descarga turbo del vídeo…';
  }

  if (active) throw new RequestError(409, 'Ya se está procesando otro proyecto. Espera a que termine o cancélalo.');
  active = job;
  const controller = new AbortController();
  activeController = controller;
  try {
    await save(job);
  } catch (error) {
    active = null;
    activeController = null;
    throw error;
  }
  activeExecution = execute(job, engine, progress.sourcePath ?? undefined, controller);
  return job;
}

export { jobsDir, idPattern, relativePath as jobDirectory, readCheckpoint, buildWaveform, findCachedSourceByVideoId, linkOrCopy };
export const saveJobRecord = save;
export const reportJobState = report;

export async function getJob(id) {
  if (!idPattern.test(id)) return null;
  if (active?.id === id) {
    return { ...active, canResume: false, url: youtube.sourceFromJob(active).url };
  }
  try {
    const job = JSON.parse(await readFile(join(jobsDir, id, 'job.json'), 'utf8'));
    if (job.provider !== 'agent' && !['done', 'error'].includes(job.stage)) {
      job.stage = 'error';
      job.message = 'El proceso se detuvo. Pulsa Terminar vídeo para continuar desde la última fase guardada.';
    }
    if (!job.sourceReady) {
      job.sourceReady = Boolean(await getSourceFile(id));
    }
    if ((!Array.isArray(job.waveform) || job.waveform.length !== 160 || job.waveformVersion !== 2) && job.stage !== 'downloading' && job.stage !== 'transcribing') {
      const savedTranscript = await readCheckpoint(join(jobsDir, id), 'transcript.json');
      const segments = savedTranscript?.segments ?? [];
      if (segments.length) {
        job.duration = job.duration || segments.at(-1)?.end || 0;
        job.segmentCount = job.segmentCount || segments.length;
        job.waveform = buildWaveform(segments, job.duration, 160);
        job.waveformVersion = 2;
      }
    }
    if (!Array.isArray(job.candidates) || !job.candidates.length) {
      const savedCandidates = await readCheckpoint(join(jobsDir, id), 'candidates.json');
      const sourceList = Array.isArray(savedCandidates) && savedCandidates.length
        ? savedCandidates
        : (Array.isArray(job.clips) && job.clips.length ? job.clips : null);
      if (sourceList) {
        job.candidates = sourceList.map((clip, index) => ({
          index: index + 1,
          expectedFile: clip.file || `clip-${index + 1}.mp4`,
          start: clip.start,
          end: clip.end,
          title: clip.title,
          onScreenHook: clip.onScreenHook,
          category: clip.category,
          reason: clip.reason,
          ratio: clip.ratio ?? job.format?.ratio ?? '9:16',
          ...(job.clips?.[index]?.framing ? { framing: job.clips[index].framing } : clip.framing ? { framing: clip.framing } : {}),
        }));
      }
    }
    const progress = await inspectSavedProgress(id, job).catch(() => ({ resumeStep: 0, remainingClips: 0 }));
    job.resumeStep = progress.resumeStep;
    job.remainingClips = progress.remainingClips;
    job.canResume = job.stage === 'error';
    job.canSearchMore = job.mode !== 'summary' && job.stage === 'done' && Boolean(progress.sourcePath && progress.hasTranscript);
    job.url = youtube.sourceFromJob(job).url;
    return job;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function listJobs() {
  let entries;
  try {
    entries = await readdir(jobsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const history = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    try {
      const job = await getJob(entry.name);
      if (!job || !job.videoId || !Array.isArray(job.clips)) continue;
      const { mtime } = await stat(join(relativePath(job), 'job.json'));
      history.push({
        id: job.id,
        videoId: job.videoId,
        sourcePlatform: job.sourcePlatform || youtube.sourceFromJob(job).platform,
        sourceKind: job.sourceKind || youtube.sourceFromJob(job).kind,
        url: youtube.sourceFromJob(job).url,
        title: job.title,
        stage: job.stage,
        localModel: job.localModel,
        engineLabel: job.engineLabel,
        provider: job.provider,
        clipCount: job.clips.length,
        duration: job.duration || 0,
        sourceReady: Boolean(job.sourceReady),
        updatedAt: mtime.toISOString(),
      });
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  return history.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getClipFile(id, name) {
  if (!/^clip-\d+\.mp4$/.test(name)) return null;
  const job = await getJob(id);
  return job?.clips.some(({ file }) => file === name) ? join(relativePath(job), name) : null;
}

export async function getSourceFile(id) {
  if (!idPattern.test(id)) return null;
  try {
    const entries = await readdir(join(jobsDir, id));
    const sourceName = entries.find((name) => /^source\.(mkv|mp4|webm|m4v|mov|avi|flv|3gp|ts)$/i.test(name));
    return sourceName ? join(jobsDir, id, sourceName) : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getTranscript(id) {
  const job = await getJob(id);
  if (!job || job.stage === 'downloading' || job.stage === 'transcribing') return null;
  try {
    const { language, segments } = JSON.parse(await readFile(join(relativePath(job), 'transcript.json'), 'utf8'));
    return { language, segments: segments.map(({ id, start, end, text }) => ({ id, start, end, text })) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
