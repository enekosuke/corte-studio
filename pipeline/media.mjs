import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import youtube from '../dist/youtube.js';
import { RequestError } from './errors.mjs';
import { buildAudioGraph, censorText, pickBgm, planSfxEvents, profanityRanges } from './audio.mjs';
import { brandLogoFile, getBrand, watermarkOverlay } from './brands.mjs';
import {
  buildTimeline, fixWordTimings, hexToAss, highlightSet, isFiller, mapTime, normWord, phraseBoundaries, planColdOpen, planSilenceParts, punchFilter, punchTimes, retarget,
  timelineChangesClip, timelineCues, trimGraph, wordsInRange,
} from './clipfx.mjs';
import { pythonOrDefault } from './runtime.mjs';
import { compositionGraph, containOffsetY, defaultFormat, insetTitleReserve, layoutPanels, outputSize } from './formats.mjs';

export const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));
const speechScript = fileURLToPath(new URL('./transcribe.py', import.meta.url));
const webcamScript = fileURLToPath(new URL('./webcam.py', import.meta.url));
const twitchScript = fileURLToPath(new URL('./twitch_snapshot.py', import.meta.url));
const youtubeLiveScript = fileURLToPath(new URL('./youtube_live.py', import.meta.url));
const voiceoverScript = fileURLToPath(new URL('./voiceover.py', import.meta.url));
const ttsModelsDir = join(dataDir, 'tts-models');
const mediaProbe = fileURLToPath(new URL('../dist/assets/podcast.png', import.meta.url));
const prototypeSounds = ['opening', 'pause', 'resume'].map((name) =>
  fileURLToPath(new URL(`./assets/prototype-sfx/${name}.ogg`, import.meta.url)));
const python = await pythonOrDefault();
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
// Errores de archivos temporales de fragmentos: en Windows, el antivirus o el indexador pueden retener o mover un
// fragmento justo cuando yt-dlp lo necesita («No such file or directory: ...part-Frag47»). Se arreglan reintentando.
export const isFragmentFileError = (message) => /part-Frag\d+|No such file or directory|WinError (?:2|3|5|32)\b|PermissionError|Access is denied|being used by another process/i.test(String(message ?? ''));

/**
 * Borra los restos de una captura anterior. Un directo no es reanudable: cada intento calcula una ventana nueva de
 * fragmentos, y reutilizar la pista de vídeo de otro intento con un audio de otra ventana dejaría el resultado
 * desincronizado. Se conservan el vídeo final (`source.mkv`...) y todo lo que no sea de la captura.
 */
export async function cleanLiveLeftovers(directory) {
  const removed = [];
  for (const name of await readdir(directory).catch(() => [])) {
    if (/^source\.f\d+\./i.test(name) || /^source\..*(?:\.part|\.ytdl)(?:-Frag\d+)?$/i.test(name) || /\.part-Frag\d+$/i.test(name)) {
      await rm(join(directory, name), { force: true, maxRetries: 6, retryDelay: 150 }).catch(() => {});
      removed.push(name);
    }
  }
  return removed;
}

async function downloadYouTubeLiveFromStart(sourceUrl, directory, ffmpeg, { signal, onStdoutLine, maxFragments = 0 } = {}) {
  // Primer intento con 4 fragmentos a la vez; si falla por archivos temporales, se limpia todo y se repite con 1.
  const concurrencies = [4, 1, 1];
  let res;
  for (const [index, concurrency] of concurrencies.entries()) {
    // Siempre se empieza limpio, también en el primer intento: un directo no es reanudable y los restos de una captura
    // anterior (otra ventana de fragmentos) desincronizarían el audio y el vídeo.
    await cleanLiveLeftovers(directory);
    if (index > 0) onStdoutLine?.('download:0.0%|Reintentando|0 MB|—');
    const args = ['-u', youtubeLiveScript, sourceUrl, directory, dirname(ffmpeg), '--concurrency', String(concurrency)];
    if (maxFragments > 0) args.push('--max-fragments', String(maxFragments));
    try {
      res = await run(python, args, { cwd: directory, env: pythonEnvironment(), timeout: 120 * 60_000, signal, onStdoutLine });
      break;
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      if (index < concurrencies.length - 1 && isFragmentFileError(`${error.message}\n${error.stderr ?? ''}`)) continue;
      const lastLine = (error.stdout ?? '').trim().split(/\r?\n/).at(-1) || '';
      try {
        const errJson = JSON.parse(lastLine);
        if (errJson?.message) throw new RequestError(422, errJson.message);
      } catch (parseErr) {
        if (parseErr instanceof RequestError) throw parseErr;
      }
      throw new RequestError(502, `La captura del directo de YouTube falló. ${error.message.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 220) ?? ''}`.trim());
    }
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
    const buildDlArgs = (concurrency) => [
      '-u', '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-simulate', '--no-warnings',
      '--no-write-subs', '--no-write-auto-subs', '--no-embed-metadata', '--no-embed-thumbnail',
      '--continue', '--concurrent-fragments', String(concurrency), '--buffer-size', '256K',
      '--newline', '--progress', '--progress-template', 'download:CORTE_DL:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._downloaded_bytes_str)s|%(progress._eta_str)s',
      '--ffmpeg-location', dirname(ffmpeg),
      '--socket-timeout', '25', '--retries', '8', '--fragment-retries', '8',
      ...(isLocalSnapshot ? ['--enable-file-urls'] : []),
      ...(!isTwitch ? ['--js-runtimes', `node:${process.execPath}`, '--match-filter', '!is_live'] : []),
      ...(!isLocalSnapshot ? ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b'] : []),
      '--merge-output-format', 'mkv',
      '-o', 'source.%(ext)s',
      '--print', 'before_dl:CORTE_TITLE:%(title)j',
      '--print', 'before_dl:CORTE_CHANNEL:%(channel)j',
      '--', targetUrl,
    ];

    const runDownload = (concurrency) => run(python, buildDlArgs(concurrency), { cwd: directory, env: pythonEnvironment(), timeout: 90 * 60_000, signal, onStdoutLine: handleStdout });
    try {
      try {
        result = await runDownload(8);
      } catch (raceError) {
        // Un vídeo normal sí se puede reanudar: se borran solo los fragmentos temporales a medias y se repite de uno en uno.
        if (raceError.code === 'CANCELLED' || !isFragmentFileError(`${raceError.message}\n${raceError.stderr ?? ''}`)) throw raceError;
        for (const name of await readdir(directory).catch(() => [])) {
          if (/\.part-Frag\d+$/i.test(name) || /\.ytdl$/i.test(name)) await rm(join(directory, name), { force: true, maxRetries: 6, retryDelay: 150 }).catch(() => {});
        }
        result = await runDownload(1);
      }
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
  let channel = ytLiveMeta?.channel || resolvedTwitch?.channel;
  if (!channel) {
    const line = result?.stdout?.split(/\r?\n/).find((line) => line.startsWith('CORTE_CHANNEL:'));
    try { if (line) channel = JSON.parse(line.slice('CORTE_CHANNEL:'.length)); } catch { /* Metadata is optional. */ }
  }
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
    ...(typeof channel === 'string' && channel.trim() && channel !== 'NA' ? { channel: channel.trim().slice(0, 120) } : {}),
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

const classicStyle = Object.freeze({ preset: 'classic-karaoke', accent: '&H0000EAFF&', keywords: new Set(), uppercase: false, maxWords: 4, censor: false, autoKeyword: false });

/** Estilo de subtítulos del clip: el preset de la marca, su color de acento y las palabras clave que sugirió la IA. */
function subtitleStyle(brand, clip) {
  const pop = brand?.subtitlePreset === 'hormozi-pop';
  return {
    preset: pop ? 'hormozi-pop' : 'classic-karaoke',
    accent: hexToAss(brand?.accentHex),
    keywords: highlightSet(clip?.highlightWords),
    uppercase: pop,
    maxWords: pop ? 3 : 4,
    censor: brand?.bleepProfanity !== false,
    autoKeyword: pop,
  };
}

/** Texto de un subtítulo con la palabra activa resaltada. El estilo clásico se conserva idéntico. */
const keywordStopwords = new Set(['porque', 'entonces', 'tambien', 'cuando', 'aunque', 'ahora', 'siempre', 'nunca', 'todavia', 'ademas', 'mismo', 'cuanto', 'donde']);

/** Palabra más larga de la frase (mín. 5 letras, o una cifra) como clave cuando la IA no marcó ninguna. */
function pickKeyIndex(tokens) {
  let best = -1;
  let bestLength = 4;
  tokens.forEach((entry, index) => {
    const word = normWord(entry.text);
    const score = /\d/.test(word) ? 99 : word.length;
    if (!keywordStopwords.has(word) && score > bestLength) {
      best = index;
      bestLength = score;
    }
  });
  return best;
}

function karaokeText(cue, activeIndex, style) {
  const autoIndex = style.autoKeyword && !style.keywords.size ? pickKeyIndex(cue.tokens) : -1;
  return cue.tokens.map((entry, idx) => {
    if (idx === activeIndex) {
      return style.preset === 'hormozi-pop'
        ? `{\\c${style.accent}\\fscx92\\fscy92\\t(0,75,\\fscx112\\fscy112)\\t(75,160,\\fscx100\\fscy100)}${entry.text}{\\r}`
        : `{\\c&H0000EAFF&\\fscx112\\fscy112}${entry.text}{\\r}`;
    }
    return (style.keywords.size && style.keywords.has(normWord(entry.text))) || idx === autoIndex ? `{\\c${style.accent}}${entry.text}{\\r}` : entry.text;
  }).join(' ');
}

function subtitleCues(clip, transcript, style = classicStyle) {
  const relevant = transcript.segments.filter((segment) => segment.end > clip.start && segment.start < clip.end);
  const hasWordTimings = relevant.some((segment) => segment.words?.length);
  // Con tiempos por palabra, cada palabra pertenece al tramo donde está su punto medio (así un corte no deja trozos de la
  // palabra vecina) y las muletillas («eeeh», «mmm») no se subtitulan.
  const rawWords = relevant
    .flatMap((segment) => segment.words?.length ? segment.words : [{ start: segment.start, end: segment.end, text: segment.text }])
    .filter((word) => (hasWordTimings
      ? (word.start + word.end) / 2 >= clip.start && (word.start + word.end) / 2 <= clip.end && !isFiller(word)
      : word.end > clip.start && word.start < clip.end));
  const words = hasWordTimings ? fixWordTimings(rawWords) : rawWords;
  const caps = (value) => (style.censor ? censorText(style.uppercase ? value.toUpperCase() : value) : (style.uppercase ? value.toUpperCase() : value));
  const maxWords = hasWordTimings ? style.maxWords : 7;
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
      return { start: wStart - clip.start, end: wEnd - clip.start, text: caps(sanitizeAssText(word.text)) };
    }).filter(({ text }) => text);
    const text = caps(sanitizeAssText(cue.map((word) => word.text).join(' ')));
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

function fitInsetHook(text, width, bandHeight, scale) {
  const measure = (line) => [...line].reduce((length, glyph) => length +
    (/[MW@]/.test(glyph) ? 1.01 : /[ilI1.,! ]/.test(glyph) ? 0.38 : /[A-ZÁÉÍÓÚÑ]/.test(glyph) ? 0.79 : 0.62), 0);
  const fontFor = (lines) => Math.floor(Math.min(88 * scale,
    (bandHeight - 18 * scale) / (lines.length * 1.16),
    width * 0.86 / Math.max(1, ...lines.map(measure))));
  let lines = [text];
  let font = fontFor(lines);
  const words = text.split(' ');
  let widest = measure(text);
  for (let split = 1; split < words.length; split++) {
    const pair = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    const pairWidth = Math.max(...pair.map(measure));
    const pairFont = fontFor(pair);
    if (pairFont > font || (lines.length === 2 && pairFont === font && pairWidth < widest)) {
      lines = pair;
      font = pairFont;
      widest = pairWidth;
    }
  }
  return { text: lines.join('\\N'), font };
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

function buildNarratorEvents(words, { previewDur, resumeAt, voiceDelay, width, height, scale, fgTop, fgHeight }) {
  const events = [];
  const center = Math.round(width / 2);
  const narratorY = Math.min(Math.round(height * 0.77), Math.round(fgTop + fgHeight + 105 * scale));
  const labelX = Math.round(width * 0.075);
  const labelY = Math.round(Math.min(fgTop + fgHeight * 0.16, narratorY - 210 * scale));
  const barWidth = Math.round(Math.min(width * 0.25, 256 * scale));
  const barHeight = Math.max(3, Math.round(6 * scale));
  const barY = labelY + Math.round(49 * scale);
  const rectangle = `m 0 0 l ${barWidth} 0 ${barWidth} ${barHeight} 0 ${barHeight}`;
  const pauseStart = assTime(previewDur);
  const pauseEnd = assTime(resumeAt);
  const pauseMs = Math.round((resumeAt - previewDur) * 1000);
  events.push(
    `Dialogue: 2,${pauseStart},${pauseEnd},Hook,,0,0,0,,{\\an7\\pos(${labelX},${labelY})\\fs${Math.round(34 * scale)}\\bord${Math.round(5 * scale)}\\fsp2\\c&H004BDDFF&\\fad(90,90)}II  PAUSA`,
    `Dialogue: 2,${pauseStart},${pauseEnd},Narrator,,0,0,0,,{\\an7\\pos(${labelX},${barY})\\bord0\\shad0\\c&H00666B76&\\p1}${rectangle}{\\p0}`,
    `Dialogue: 3,${pauseStart},${pauseEnd},Narrator,,0,0,0,,{\\an7\\pos(${labelX},${barY})\\bord0\\shad0\\c&H004BDDFF&\\fscx1\\t(0,${pauseMs},\\fscx100)\\p1}${rectangle}{\\p0}`,
  );
  let offset = 0;
  while (offset < words.length) {
    let end = offset + 1;
    while (end < words.length && end - offset < 4 &&
      words.slice(offset, end + 1).map(({ text }) => text).join(' ').length <= 24) end++;
    const chunk = words.slice(offset, end);
    offset = end;
    const cStart = voiceDelay + chunk[0].start;
    const cEnd = Math.min(resumeAt, voiceDelay + (words[offset]?.start ?? chunk.at(-1).end + 0.14));
    for (const [idx, tok] of chunk.entries()) {
      const sStart = idx === 0 ? cStart : voiceDelay + tok.start;
      const sEnd = idx === chunk.length - 1 ? cEnd : Math.min(cEnd, voiceDelay + chunk[idx + 1].start);
      if (sEnd - sStart <= 0.02) continue;
      const formatted = chunk.map((w, j) => {
        const safe = sanitizeAssText(w.text);
        return j === idx ? `{\\c&H004BDDFF&}${safe}{\\c&H00FFFFFF&}` : safe;
      }).join(' ');
      events.push(`Dialogue: 3,${assTime(sStart)},${assTime(sEnd)},Narrator,,0,0,0,,{\\an5\\pos(${center},${narratorY})}${formatted}`);
    }
  }
  return events;
}

async function writeSubtitles(path, clip, transcript, format, plan = {}, { aspect = 16 / 9, prototypeOverlay = null, cues = null, style = classicStyle } = {}) {
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
    const reserve = insetTitleReserve(format);
    const visibleFgH = Math.min(panel1.height - reserve, Math.round(panel1.width / contentAspect));
    insetPanelTop = panel1.y;
    insetGapHeight = Math.max(reserve, containOffsetY(panel1.height, visibleFgH, 'bottom'));
  }

  const gapHeight = layout === 'fit' ? fgTop - badgeBottom : insetGapHeight;
  const persistentFitHook = layout === 'fit' && gapHeight >= 90;
  const persistentInsetHook = insetLayout;

  const rawHook = clip.onScreenHook || clip.title;
  const hook = sanitizeAssText(rawHook).slice(0, 72);
  const insetHook = persistentInsetHook ? fitInsetHook(hook, width, insetGapHeight, scale) : null;
  const formattedHook = insetHook?.text ?? wrapHookLines(hook, width > height ? 28 : (persistentFitHook ? 22 : 20));
  const lineCount = formattedHook ? formattedHook.split('\\N').length : 0;

  const hookFont = persistentFitHook
    ? (lineCount >= 2
      ? Math.min(60, Math.max(36, Math.round(gapHeight * 0.155)))
      : Math.min(76, Math.max(42, Math.round(gapHeight * 0.21))))
    : (insetHook?.font ?? Math.max(46, Math.round((lineCount >= 2 ? 68 : 78) * scale)));
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
  if (hook && prototypeOverlay) {
    const titleEnd = Math.min(prototypeOverlay.resumeAt + 0.86, prototypeOverlay.totalDuration);
    const y = persistentFitHook ? Math.round(badgeBottom + gapHeight / 2) : Math.round(height * 0.19);
    const introHook = highlightHookText(wrapHookLines(hook, 21));
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(titleEnd)},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${y})\\fscx92\\fscy92\\t(0,140,\\fscx100\\fscy100)\\fad(0,210)}${introHook}`);
  } else if (hook) {
    const richHook = highlightHookText(formattedHook);
    const popTag = persistentInsetHook
      ? '\\fscx90\\fscy90\\t(0,180,\\fscx100\\fscy100)'
      : '\\fscx84\\fscy84\\t(0,170,\\fscx108\\fscy108)\\t(170,290,\\fscx100\\fscy100)';
    const clipDuration = Math.max(0.5, prototypeOverlay?.totalDuration ?? (clip.end - clip.start));
    if (persistentFitHook) {
      const gapCenterY = Math.round(badgeBottom + gapHeight / 2);
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(clipDuration)},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${gapCenterY})${popTag}}${richHook}`);
    } else if (persistentInsetHook) {
      const insetHookY = Math.round(insetPanelTop + insetGapHeight / 2);
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(clipDuration)},Hook,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${insetHookY})${popTag}}${richHook}`);
    } else {
      const hookEnd = Math.min(4.2, Math.max(1.2, clipDuration * 0.55));
      lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookEnd)},Hook,,0,0,0,,{${popTag}\\fad(80,260)}${richHook}`);
    }
  }
  if (prototypeOverlay) {
    lines.push(...buildNarratorEvents(prototypeOverlay.words, { ...prototypeOverlay, width, height, scale, fgTop, fgHeight }));
  }
  const subtitleSpans = prototypeOverlay
    ? [
        { from: 0, to: prototypeOverlay.previewDur, shift: 0 },
        { from: prototypeOverlay.previewDur, to: prototypeOverlay.totalDuration - prototypeOverlay.freezeDur, shift: prototypeOverlay.freezeDur },
      ]
    : [{ from: 0, to: Infinity, shift: 0 }];
  for (const cue of cues ?? subtitleCues(clip, transcript, style)) {
    const emit = (start, end, text) => {
      for (const { from, to, shift } of subtitleSpans) {
        const spanStart = Math.max(from, start) + shift;
        const spanEnd = Math.min(to, end) + shift;
        if (spanEnd - spanStart > 0.02) lines.push(`Dialogue: 0,${assTime(spanStart)},${assTime(spanEnd)},Corte,,0,0,0,,${text}`);
      }
    };
    if (!cue.tokens) emit(cue.start, cue.end, cue.text);
    else for (const [activeIndex, token] of cue.tokens.entries()) {
      const start = activeIndex === 0 ? cue.start : token.start;
      const end = activeIndex === cue.tokens.length - 1 ? cue.end : cue.tokens[activeIndex + 1].start;
      const formatted = karaokeText(cue, activeIndex, style);
      emit(start, end, formatted);
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
  if (!parsed?.path || !Number.isFinite(parsed.duration) || parsed.duration <= 0 || !Array.isArray(parsed.words)) {
    throw new RequestError(502, 'El modelo de voz local no devolvió un audio válido.');
  }
  return parsed;
}

function prototypePauseFrame(clip, transcript) {
  const words = transcript.segments.flatMap(({ words }) => words ?? [])
    .filter(({ start, end }) => end > clip.start && start < clip.start + 1.4);
  const gaps = words.slice(0, -1).map((word, index) => {
    const gap = words[index + 1].start - word.end;
    return { gap, at: word.end - clip.start + Math.min(0.12, gap / 2) };
  }).filter(({ at, gap }) => at >= 0.55 && at <= 1.1 && gap >= 0.13);
  const bestGap = gaps.reduce((best, candidate) => candidate.gap > (best?.gap ?? 0) ? candidate : best, null);
  return Math.round((bestGap?.at ?? 0.8) * 30);
}

function prototypeReactionTime(segments, bodyStart, bodyEnd) {
  const reactions = segments.filter(({ start, energy, text }) =>
    start >= bodyStart + 1.4 && start < bodyEnd - 0.75 && energy >= 7 && /[¡!]/.test(text));
  const strongest = reactions.reduce((best, segment) => segment.energy >= (best?.energy ?? 0) ? segment : best, null);
  return strongest ? strongest.start - bodyStart : null;
}

const badgeFont = () => (process.platform === 'win32' ? "font='Segoe UI Semibold'" : "font='DejaVu Sans'");

/** Cadena de filtros del distintivo de marca: logo + @handle en una píldora con esquinas redondeadas. */
function brandBadge(brand, rounded) {
  return `[1:v]scale=60:60,format=rgba,pad=310:84:12:12:color=0x171820@0.78,drawtext=${badgeFont()}:text='${brand.handle}':fontsize=40:fontcolor=white:x=85:y=(h-th)/2,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${rounded}'[brand]`;
}

export async function renderPrototypeClip(source, directory, clip, transcript, plan, clipNumber, format = defaultFormat, mediaOptions = {}) {
  const { ffmpeg, cuda, nvenc } = await getMediaTools();
  const { signal, voice = 'piper:es_ES-davefx-medium' } = mediaOptions;
  const brand = mediaOptions.brand ?? await getBrand();
  const logo = await brandLogoFile(brand);
  const name = `clip-${clipNumber}`;
  const wavPath = join(directory, `${name}-voice.wav`);
  const narrationText = (clip.narration || clip.onScreenHook || clip.title || '').trim();
  const vo = await synthesizeVoiceover(narrationText, wavPath, { voice, signal });

  const [width, height] = outputSize(format);
  const sourceFrames = Math.floor((clip.end - clip.start) * 30);
  const pauseFrame = Math.min(Math.floor(sourceFrames / 3), prototypePauseFrame(clip, transcript));
  const previewDur = pauseFrame / 30;
  const voiceTempo = Math.max(1, vo.duration / 4.1);
  const voiceDelay = previewDur + 0.14;
  const freezeFrames = Math.ceil((0.14 + vo.duration / voiceTempo + 0.17) * 30);
  const freezeDur = freezeFrames / 30;
  const resumeAt = previewDur + freezeDur;
  const endFrame = Math.min(sourceFrames, 894 - freezeFrames);
  const totalDuration = (endFrame + freezeFrames) / 30;
  const words = vo.words.map((word) => ({ ...word, start: word.start / voiceTempo, end: word.end / voiceTempo }));
  const reactionTime = prototypeReactionTime(mediaOptions.audioSegments ?? transcript.segments,
    clip.start + previewDur, clip.start + endFrame / 30);
  const protoPlan = { ...plan, layout: 'fit' };

  await writeSubtitles(join(directory, `${name}.ass`), clip, transcript, format, protoPlan, {
    ...mediaOptions,
    prototypeOverlay: { previewDur, freezeDur, voiceDelay, resumeAt, totalDuration, words },
  });

  const baseGraph = compositionGraph(protoPlan, format);
  const rounded = 'clip(15-hypot(max(abs(X-(W-1)/2)-(W/2-15),0),max(abs(Y-(H-1)/2)-(H/2-15),0)),0,1)';
  const fadeOutSt = Math.max(0, previewDur - 0.04);
  const pauseMs = Math.round(previewDur * 1000);
  const voiceMs = Math.round(voiceDelay * 1000);
  const resumeMs = Math.round(resumeAt * 1000);
  const zoom = (envelope) => [
    `scale=w='trunc(${width}*(${envelope})/2)*2':h='trunc(${height}*(${envelope})/2)*2':flags=bilinear:eval=frame`,
    `crop=${width}:${height}:(in_w-${width})/2:(in_h-${height})/2,setsar=1`,
  ].join(',');
  const openingZoom = zoom(`1+0.045*pow(max(0,1-t/${decimal(previewDur)}),2)`);
  const freezeZoom = zoom(`1+0.066*(1-exp(-t/0.12))*min(1,max(0,(${decimal(freezeDur)}-t)/0.22))`);
  const reactionZoom = reactionTime === null ? '' : `,${zoom(`1+0.052*exp(-pow((t-${decimal(reactionTime + 0.12)})/0.27,2))`)}`;

  const freezeFx = [
    `trim=start_frame=${pauseFrame}:end_frame=${pauseFrame + 1},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${freezeFrames - 1}`,
    freezeZoom,
    `eq=brightness='-0.095*(1-exp(-t/0.12))*min(1,max(0,(${decimal(freezeDur)}-t)/0.18))':saturation='1-0.46*(1-exp(-t/0.12))*min(1,max(0,(${decimal(freezeDur)}-t)/0.18))':eval=frame`,
  ].join(',');

  const videoGraph = [
    `${baseGraph},fps=30,setsar=1,split=3[p_raw][f_raw][b_raw]`,
    `[p_raw]trim=end_frame=${pauseFrame},setpts=PTS-STARTPTS,${openingZoom}[seg0]`,
    `[f_raw]${freezeFx}[seg1]`,
    `[b_raw]trim=start_frame=${pauseFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS${reactionZoom},eq=saturation='1+0.16*exp(-t/0.23)':eval=frame[seg2]`,
    `[seg0][seg1][seg2]concat=n=3:v=1:a=0,fps=30,setsar=1,ass=${name}.ass[${brand.showWatermark ? 'captioned' : 'out'}]`,
    ...(brand.showWatermark ? [
      brandBadge(brand, rounded),
      `[captioned][brand]overlay=${watermarkOverlay(brand, { top: 'H*7/120' })}:eof_action=repeat[out]`,
    ] : []),
  ].join(';');

  const bodyDur = (endFrame - pauseFrame) / 30;
  const audioGraph = [
    '[0:a]aresample=44100,aformat=channel_layouts=stereo,acompressor=threshold=0.19:ratio=2.6:attack=8:release=90,asplit=2[opening_src][body_src]',
    `[opening_src]atrim=duration=${decimal(previewDur)},asetpts=PTS-STARTPTS,afade=t=out:st=${decimal(fadeOutSt)}:d=0.04,volume=0.82[a0]`,
    `anullsrc=r=44100:cl=stereo:d=${decimal(freezeDur)}[a1]`,
    `[body_src]atrim=start=${decimal(previewDur)}:duration=${decimal(bodyDur)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05,afade=t=out:st=${decimal(Math.max(0, bodyDur - 0.06))}:d=0.06[a2]`,
    `[a0][a1][a2]concat=n=3:v=0:a=1[a_base]`,
    '[3:a]aresample=44100,aformat=channel_layouts=stereo,highpass=f=110,volume=0.24,adelay=25:all=1[sfx_open]',
    `[4:a]aresample=44100,aformat=channel_layouts=stereo,lowpass=f=2600,volume=0.38,adelay=${pauseMs}:all=1[sfx_pause]`,
    `[5:a]aresample=44100,aformat=channel_layouts=stereo,highpass=f=130,volume=0.29,adelay=${Math.max(0, resumeMs - 85)}:all=1[sfx_resume]`,
    `[2:a]aresample=44100,aformat=channel_layouts=stereo,highpass=f=85,equalizer=f=2700:width_type=o:width=1.5:g=1.4,atempo=${decimal(voiceTempo)},adelay=${voiceMs}:all=1[vo]`,
    '[a_base][sfx_open][sfx_pause][sfx_resume][vo]amix=inputs=5:duration=first:normalize=0,loudnorm=I=-17:TP=-2:LRA=9,aresample=44100[aout]',
  ].join(';');

  const partial = join(directory, `${name}.partial.mp4`);
  const videoEncoder = nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4'];
  try {
    await runFfmpeg(ffmpeg, cuda, (useCuda) => [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...(useCuda ? ['-hwaccel', 'cuda'] : []), '-ss', decimal(clip.start), '-i', source,
      '-i', logo, '-i', vo.path, ...prototypeSounds.flatMap((path) => ['-i', path]),
      '-filter_complex_threads', '2', '-filter_complex', `${videoGraph};${audioGraph}`,
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
  const brand = mediaOptions.brand ?? await getBrand();
  const logo = await brandLogoFile(brand);
  const name = `clip-${clipNumber}`;
  const [width, height] = outputSize(format);
  const style = subtitleStyle(brand, clip);

  // Montaje de ritmo: sin pausas largas ni muletillas en clips de charla y, si la IA lo pide, el pico por delante como gancho.
  // En gameplay no se cortan los silencios: el vídeo sigue teniendo acción aunque nadie hable.
  const talking = !['gameplay', 'shared'].includes(plan.layout);
  const jumpCuts = mediaOptions.jumpCuts ?? talking;
  const coldOpen = mediaOptions.coldOpen ?? true;
  let timeline = null;
  if (jumpCuts || (coldOpen && clip.hasColdOpenHook)) {
    const silence = jumpCuts ? planSilenceParts(wordsInRange(transcript, clip.start, clip.end), clip) : [{ start: clip.start, end: clip.end }];
    const cold = coldOpen && clip.hasColdOpenHook ? planColdOpen(clip, transcript, clip.peakSegmentId) : null;
    const candidate = buildTimeline(clip, silence, cold);
    if (timelineChangesClip(candidate)) timeline = candidate;
  }
  const outDuration = timeline ? timeline.total : clip.end - clip.start;
  const toOutput = (absolute) => (timeline ? mapTime(timeline, absolute) : absolute - clip.start);

  // Picos de energía: empuje con temblor, golpe de sonido y, el más fuerte, punto donde la música calla un instante.
  const punchAbsolute = mediaOptions.punch === false ? [] : punchTimes(mediaOptions.audioSegments, clip);
  const punchRelative = punchAbsolute.map(toOutput).filter((time) => time !== null);
  const alternate = talking && mediaOptions.phraseZoom !== false ? phraseBoundaries(transcript, clip, timeline) : [];
  const coldSeconds = timeline?.cold ? timeline.parts[0].duration : 0;
  const strongest = (mediaOptions.audioSegments ?? [])
    .filter((segment) => Number.isFinite(segment.energy) && segment.start > clip.start + 1.5 && segment.start < clip.end)
    .sort((a, b) => b.energy - a.energy)[0];
  const climaxAt = strongest ? toOutput(strongest.start) : null;

  // Censura: la palabrota se silencia y se tapa con un pitido; el subtítulo también sale censurado.
  const spokenWords = wordsInRange(transcript, clip.start, clip.end);
  const bleeps = style.censor ? profanityRanges(spokenWords, clip, timeline) : [];

  const cues = timeline ? timelineCues(timeline, (range) => subtitleCues(range, transcript, style)) : null;
  await writeSubtitles(join(directory, `${name}.ass`), timeline ? { ...clip, start: 0, end: timeline.total } : clip, transcript, format, plan, { ...mediaOptions, cues, style });

  let graph = compositionGraph(plan, format, { reserveInsetTitle: Boolean(sanitizeAssText(clip.onScreenHook || clip.title)) });
  const rounded = 'clip(15-hypot(max(abs(X-(W-1)/2)-(W/2-15),0),max(abs(Y-(H-1)/2)-(H/2-15),0)),0,1)';
  const badgeY = ['gameplay', 'shared'].includes(plan.layout) ? '12' : 'H*7/120';
  const zoom = punchFilter(punchRelative, width, height, { alternate, cold: coldSeconds });
  if (timeline) graph = retarget(graph);
  graph += `${zoom ? `,${zoom}` : ''},fps=30,setsar=1,ass=${name}.ass`;
  graph += brand.showWatermark
    ? `[captioned];${brandBadge(brand, rounded)};[captioned][brand]overlay=${watermarkOverlay(brand, { top: badgeY })}:eof_action=repeat[out]`
    : '[out]';

  // Audio: efectos, música con ducking y sonoridad final (-16 LUFS).
  const loudness = 'loudnorm=I=-16:TP=-1.5:LRA=11';
  const sfx = brand.sfx !== false && mediaOptions.sfx !== false
    ? planSfxEvents({ hasHook: Boolean(sanitizeAssText(clip.onScreenHook)), cold: coldSeconds > 0, punches: punchRelative }) : [];
  const bgm = mediaOptions.bgm === false ? null : await pickBgm(brand, clipNumber);
  let audioArgs = ['-map', '0:a:0?', '-af', loudness];
  let extraInputs = [];
  if (timeline || sfx.length || bleeps.length || bgm) {
    const trimmed = timeline ? trimGraph(timeline, clip.start) : null;
    const voice = trimmed ? trimmed.audio : '[0:a:0]aresample=48000,aformat=channel_layouts=stereo[voice0]';
    const audio = buildAudioGraph({ voicePolish: mediaOptions.voicePolish === true,  duration: outDuration, bleeps, bgm, climaxAt, sfx, firstInput: 2, loudness });
    graph = `${trimmed ? `${trimmed.video};` : ''}${graph};${voice};${audio.graph}`;
    extraInputs = audio.inputs;
    audioArgs = ['-map', '[aout]'];
  }
  // Resumen de lo aplicado: el orquestador lo guarda en clip.fx y los paneles lo muestran.
  if (mediaOptions.report) {
    Object.assign(mediaOptions.report, {
      cutSeconds: timeline ? Number(timeline.removed.toFixed(2)) : 0, coldOpen: coldSeconds > 0, phraseZooms: alternate.length,
      punches: punchRelative.length, bleeps: bleeps.length, sfx: sfx.map(({ name: effect }) => effect), music: Boolean(bgm),
      jumpCuts: Boolean(timeline), duration: Number(outDuration.toFixed(2)), preset: style.preset,
    });
  }
  const partial = join(directory, `${name}.partial.mp4`);
  const videoEncoder = nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4'];
  try {
    await runFfmpeg(ffmpeg, cuda, (useCuda) => [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...(useCuda ? ['-hwaccel', 'cuda'] : []), '-ss', decimal(clip.start), '-i', source,
      '-i', logo, ...extraInputs, '-t', decimal(outDuration), '-filter_complex_threads', '2', '-filter_complex', graph,
      '-map', '[out]', ...audioArgs, ...videoEncoder,
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

/** Sonoridad integrada (LUFS) de un archivo. Un clip listo para publicar debe quedar entre -17,5 y -13. */
export async function measureLoudness(path, { signal } = {}) {
  const { ffmpeg } = await getMediaTools();
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { timeout: 5 * 60_000, signal });
  const summary = String(stderr).split('Summary:').at(-1);
  const lufs = Number(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary)?.[1]);
  return Number.isFinite(lufs) ? { lufs, ok: lufs >= -17.5 && lufs <= -13 } : null;
}

const activeSpeakerScript = fileURLToPath(new URL('./active_speaker.py', import.meta.url));
const chatPeaksScript = fileURLToPath(new URL('./chat_peaks.py', import.meta.url));

/**
 * Movimiento de boca de cada persona a lo largo del clip (OpenCV). Devuelve null si no se pudo analizar.
 * Los fotogramas se muestrean a 6 por segundo en una carpeta temporal que se borra al terminar.
 */
export async function analyzeActiveSpeaker(source, directory, clip, clipNumber, { signal } = {}) {
  const { ffmpeg } = await getMediaTools();
  const frames = join(directory, 'frames', `asd-${clipNumber}`);
  await mkdir(frames, { recursive: true });
  try {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', decimal(clip.start), '-i', source, '-t', decimal(clip.end - clip.start),
      '-vf', 'fps=6,scale=640:-2', '-q:v', '4', join(frames, 'f%04d.jpg')], { cwd: directory, timeout: 5 * 60_000, signal });
    const env = pythonEnvironment();
    env.PYTHONPATH = [join(dataDir, 'vision-tools'), env.PYTHONPATH].join(delimiter);
    const { stdout } = await run(python, [activeSpeakerScript, frames, '--fps', '6', '--window', '0.5'], { cwd: directory, env, timeout: 3 * 60_000, signal });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    return null;
  } finally {
    await rm(frames, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  }
}

/**
 * Descarga el chat de un vídeo de YouTube que fue directo y anota `chatSpike` (1-10) en transcript.json.
 * Es opcional: un vídeo sin chat grabado es lo normal y devuelve { available: false }. El resultado se guarda en
 * chat-peaks.json para no repetir la consulta al reanudar.
 */
export async function fetchChatSpikes(url, directory, { signal } = {}) {
  const marker = join(directory, 'chat-peaks.json');
  try {
    return JSON.parse(await readFile(marker, 'utf8'));
  } catch { /* Primera vez en este proyecto. */ }
  const summary = { available: false, messages: 0, annotated: 0, peak: 0 };
  try {
    try {
      await run(python, ['-u', '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-warnings', '--skip-download', '--write-subs', '--sub-langs', 'live_chat', '-o', 'chat.%(ext)s', url],
        { cwd: directory, env: pythonEnvironment(), timeout: 3 * 60_000, signal });
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
    }
    const chatFile = (await readdir(directory)).find((name) => /\.live_chat\.json$/i.test(name));
    if (chatFile) {
      summary.available = true;
      const { stdout } = await run(python, [chatPeaksScript, join(directory, chatFile), join(directory, 'transcript.json')], { cwd: directory, env: pythonEnvironment(), timeout: 2 * 60_000, signal });
      Object.assign(summary, JSON.parse(stdout));
      await rm(join(directory, chatFile), { force: true });
    }
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
  }
  await writeFile(marker, JSON.stringify(summary), 'utf8');
  return summary;
}

/**
 * Auditoría de un clip terminado: sonoridad (-16 LUFS de objetivo), fotogramas no negros al principio, mitad y final,
 * pista de audio y zona segura de los subtítulos (que no pisen los botones de la parte baja de Shorts/TikTok).
 * `ok` solo es true si todas las comprobaciones pasan; `issues` dice cuáles fallan.
 */
export async function auditClip(path, { assPath, format = defaultFormat, signal } = {}) {
  const { ffmpeg } = await getMediaTools();
  const issues = [];
  const media = await probeVideo(path).catch(() => null);
  if (!media) return { ok: false, issues: ['no se pudo leer el vídeo'] };
  if (!media.audio) issues.push('sin pista de audio');

  const loudness = media.audio ? await measureLoudness(path, { signal }).catch(() => null) : null;
  if (loudness && !(loudness.lufs >= -17 && loudness.lufs <= -13.5)) issues.push(`sonoridad ${loudness.lufs.toFixed(1)} LUFS fuera de -17 a -13,5`);

  const frames = [];
  for (const at of [0.5, media.duration / 2, Math.max(0.5, media.duration - 0.4)]) {
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-ss', decimal(Math.min(at, Math.max(0, media.duration - 0.1))), '-i', path, '-frames:v', '1',
      '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { timeout: 60_000, signal }).catch(() => ({ stderr: '' }));
    const yavg = Number(/YAVG=([\d.]+)/.exec(stderr)?.[1]);
    const ymax = Number(/YMAX=([\d.]+)/.exec(stderr)?.[1]);
    // El negro de vídeo vale 16 de luminancia: se exige también que no haya ningún punto claro (una escena oscura no es un fallo).
    frames.push({ t: Number(at.toFixed(2)), ...(Number.isFinite(yavg) ? { yavg, black: yavg < 20 && (!Number.isFinite(ymax) || ymax < 48) } : {}) });
  }
  if (frames.some(({ black }) => black)) issues.push('hay un fotograma casi negro');

  if (assPath) {
    const [, height] = outputSize(format);
    const ass = await readFile(assPath, 'utf8').catch(() => '');
    const margin = Number(/^Style: Corte,[^,]*,[^,]*,(?:[^,]*,){18}(\d+),/m.exec(ass)?.[1]);
    const alignment = Number(/^Style: Corte,[^,]*,[^,]*,(?:[^,]*,){15}(\d+),/m.exec(ass)?.[1]);
    if (alignment === 2 && Number.isFinite(margin) && height > 1500 && height - margin > height * 0.86) issues.push('subtítulos dentro de la zona de botones');
  }
  return { ok: issues.length === 0, issues, lufs: loudness?.lufs ?? null, frames, duration: Number(media.duration.toFixed(2)) };
}

// ---------------------------------------------------------------------------
// Modo Resumen: render de un vídeo largo condensado a partir de una lista de tramos.
// Cada tramo se codifica por separado (con caché), se unen por copia y el audio se normaliza al final.
// ---------------------------------------------------------------------------

const summaryCardVolume = 0.12;
const summaryCardRamp = 0.9;

function wrapCardText(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const greedy = (limit) => {
    const lines = [];
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > limit) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  // Con el mismo número de líneas, se reduce el ancho para equilibrarlas y evitar una palabra suelta al final.
  const count = greedy(maxChars).length;
  let limit = maxChars;
  while (limit > 10 && greedy(limit - 1).length === count) limit--;
  return greedy(limit).slice(0, 3).join('\\N');
}

export function summaryCaptionCues(part, segments, from = 0) {
  const words = segments
    .filter((segment) => segment.end > part.start && segment.start < part.end)
    .flatMap((segment) => segment.words?.length ? segment.words : [{ start: segment.start, end: segment.end, text: segment.text }])
    .filter((word) => word.end > part.start && word.start < part.end && word.text);
  const cues = [];
  let group = [];
  const flush = () => {
    if (group.length) cues.push(group);
    group = [];
  };
  for (const word of words) {
    const previous = group.at(-1);
    const chars = group.map(({ text }) => text).join(' ').length + word.text.length + 1;
    if (previous && (group.length >= 9 || chars > 44 || word.start - previous.end > 0.6 || word.end - group[0].start > 3.6)) flush();
    group.push(word);
    if (/[.?!…]$/.test(word.text) && group.length >= 3) flush();
  }
  flush();
  return cues.map((cue, index) => {
    const start = Math.max(part.start, cue[0].start) - part.start;
    const nextStart = cues[index + 1] ? cues[index + 1][0].start - part.start : part.end - part.start;
    const end = Math.min(part.end - part.start, nextStart, Math.max(cue.at(-1).end - part.start, start + 0.6));
    return { start: Math.max(from, start), end, text: sanitizeAssText(cue.map(({ text }) => text).join(' ')) };
  }).filter(({ start, end, text }) => end - start > 0.15 && text);
}

const cardAccent = '&H003FD2FF&'; // ámbar cálido (BGR)
const cardWhite = '&H00FFFFFF&';

function cardLabel(card, language) {
  if (!/^es/i.test(language ?? 'es')) return '';
  if (card.kind === 'intro') return 'EN ESTE VÍDEO';
  if (card.kind === 'chapter' && card.number) return `CAPÍTULO ${String(card.number).padStart(2, '0')}`;
  return 'AHORA';
}

// Tarjeta tipográfica: etiqueta con acento, barra que se dibuja y frase grande con entrada escalonada.
export function summaryCardEvents(card, { width, height, language }) {
  const scale = height / 1080;
  const exit = Math.round(summaryCardRamp * 1000);
  const hold = Math.max(0.6, card.seconds);
  const text = sanitizeAssText(card.text);
  const maxChars = width > height ? (card.kind === 'intro' ? 24 : 26) : 16;
  const lines = wrapCardText(text, maxChars).split('\\N').filter(Boolean);
  const size = Math.round((card.kind === 'intro' ? 96 : 88) * scale);
  const lineHeight = Math.round(size * 1.04);
  const label = cardLabel(card, language);
  const cx = Math.round(width / 2);
  const blockHeight = lines.length * lineHeight + (label ? Math.round(86 * scale) : Math.round(36 * scale));
  const top = Math.round(height * 0.47 - blockHeight / 2);
  const events = [];
  let y = top;
  if (label) {
    const kickerSize = Math.round(34 * scale);
    events.push(`Dialogue: 2,${assTime(0.05)},${assTime(hold)},Kicker,,0,0,0,,{\\an5\\pos(${cx},${y + Math.round(kickerSize / 2)})\\alpha&HFF&\\t(0,320,\\alpha&H00&)\\fscx140\\t(0,520,\\fscx100)\\fad(0,${exit})}${label}`);
    y += Math.round(kickerSize * 1.45);
  }
  const barWidth = Math.round(132 * scale);
  const barHeight = Math.max(4, Math.round(7 * scale));
  events.push(`Dialogue: 2,${assTime(0.05)},${assTime(hold)},Bar,,0,0,0,,{\\an5\\pos(${cx},${y + Math.round(barHeight / 2)})\\c${cardAccent}\\p1\\fscx0\\t(80,620,\\fscx100)\\fad(0,${exit})}m 0 0 l ${barWidth} 0 l ${barWidth} ${barHeight} l 0 ${barHeight}{\\p0}`);
  y += barHeight + Math.round(26 * scale);
  const accentFrom = lines.length - 1; // el acento va en las últimas palabras de la última línea
  lines.forEach((line, index) => {
    const delay = 160 + index * 170;
    const words = line.split(' ');
    const marked = index >= accentFrom
      ? words.map((word, position) => (position >= Math.max(0, words.length - 2) ? `{\\c${cardAccent}}${word}{\\c${cardWhite}}` : word)).join(' ')
      : line;
    const cy = y + Math.round(lineHeight / 2);
    events.push(`Dialogue: 2,${assTime(0.05)},${assTime(hold)},Card,,0,0,0,,{\\an5\\pos(${cx},${cy})\\alpha&HFF&\\t(${delay},${delay + 340},\\alpha&H00&)\\fscx88\\fscy88\\t(${delay},${delay + 480},\\fscx100\\fscy100)\\blur2\\fad(0,${exit})}${marked}`);
    y += lineHeight;
  });
  return events;
}

async function writeSummaryPartSubtitles(path, part, segments, format, { captions, language }) {
  const [width, height] = outputSize(format);
  const scale = height / 1080;
  const cardSeconds = part.card?.seconds ?? 0;
  const lines = [];
  if (captions) {
    for (const cue of summaryCaptionCues(part, segments, cardSeconds)) {
      lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${cue.text}`);
    }
  }
  if (part.card?.text) lines.push(...summaryCardEvents(part.card, { width, height, language }));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial Black,${Math.round(46 * scale)},&H00FFFFFF,&H00FFFFFF,&H0008080F,&HB0000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(4 * scale))},${Math.max(1, Math.round(2 * scale))},2,120,120,${Math.round(64 * scale)},1
Style: Card,Segoe UI Black,${Math.round(88 * scale)},&H00FFFFFF,&H00FFFFFF,&H00120A08,&H96000000,0,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(4 * scale))},${Math.max(3, Math.round(6 * scale))},5,100,100,0,1
Style: Kicker,Segoe UI Black,${Math.round(34 * scale)},${cardAccent},${cardAccent},&H00120A08,&H96000000,0,0,0,0,100,100,9,0,1,${Math.max(1, Math.round(2 * scale))},${Math.max(2, Math.round(3 * scale))},5,60,60,0,1
Style: Bar,Segoe UI Black,20,${cardAccent},${cardAccent},&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,${Math.max(2, Math.round(3 * scale))},5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  await writeFile(path, `${header}${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8');
  return lines.length > 0;
}

export function summaryPartGraph(part, { width, height, hasSubtitles, subtitlePath }) {
  const dimensions = `${width}:${height}`;
  const base = `scale=${dimensions}:force_original_aspect_ratio=decrease,pad=${dimensions}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1`;
  const subtitles = hasSubtitles ? `,ass=${subtitlePath}` : '';
  const seconds = part.card?.seconds ?? 0;
  const fadeLength = 0.03;
  let video;
  let audio = '[0:a:0]aresample=48000,aformat=channel_layouts=stereo';
  if (seconds > 0) {
    const ramp = Math.min(summaryCardRamp, seconds / 2);
    const rampStart = (seconds - ramp).toFixed(3);
    video = `[0:v]${base},split[a][b];`
      + `[a]trim=duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS,scale=${Math.round(width / 2)}:-2,gblur=sigma=5:steps=2,scale=${dimensions},eq=brightness=-0.16:saturation=0.92,format=yuva420p,fade=t=out:st=${rampStart}:d=${ramp.toFixed(3)}:alpha=1[bl];`
      + `[b]format=yuv420p[cl];[cl][bl]overlay=eof_action=pass:format=auto${subtitles}[v]`;
    audio += `,volume='clip(${summaryCardVolume}+(1-${summaryCardVolume})*(t-${rampStart})/${ramp.toFixed(3)},${summaryCardVolume},1)':eval=frame`;
  } else {
    video = `[0:v]${base}${subtitles}[v]`;
  }
  audio += `,afade=t=in:d=${fadeLength},afade=t=out:st=${Math.max(0, part.duration - fadeLength).toFixed(3)}:d=${fadeLength}[a]`;
  return `${video};${audio}`;
}

export async function renderSummaryVideo(source, directory, plan, transcript, format, { captions = true, clipNumber = 1, signal, onProgress } = {}) {
  const { ffmpeg, cuda, nvenc } = await getMediaTools();
  const [width, height] = outputSize(format);
  const workDirectory = join(directory, 'summary-parts');
  await mkdir(workDirectory, { recursive: true });
  const encoder = nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-g', '60']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-g', '60', '-threads', '4'];
  const segments = transcript.segments;
  const entries = plan.parts.map((part, index) => {
    const key = createHash('sha1').update(JSON.stringify([part.start, part.duration, part.card ?? null, width, height, captions, nvenc])).digest('hex').slice(0, 10);
    const name = `p${String(index + 1).padStart(4, '0')}-${key}`;
    return { part, name, file: `${name}.mkv` };
  });
  const expected = new Set(entries.flatMap(({ file, name }) => [file, `${name}.ass`]).concat('list.txt'));
  for (const leftover of await readdir(workDirectory).catch(() => [])) {
    if (!expected.has(leftover)) await rm(join(workDirectory, leftover), { force: true }).catch(() => {});
  }

  let done = 0;
  let cursor = 0;
  const encodePart = async ({ part, name, file }) => {
    const target = join(workDirectory, file);
    if (!(await stat(target).then(({ size }) => size > 0, () => false))) {
      const subtitlePath = `summary-parts/${name}.ass`;
      const hasSubtitles = await writeSummaryPartSubtitles(join(workDirectory, `${name}.ass`), part, segments, format, { captions, language: transcript.language });
      const graph = summaryPartGraph(part, { width, height, hasSubtitles, subtitlePath });
      const partial = join(workDirectory, `${name}.partial.mkv`);
      try {
        await runFfmpeg(ffmpeg, cuda, (useCuda) => [
          '-hide_banner', '-loglevel', 'error', '-y',
          ...(useCuda ? ['-hwaccel', 'cuda'] : []), '-ss', decimal(part.start), '-i', source, '-t', decimal(part.duration),
          '-filter_complex_threads', '2', '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
          ...encoder, '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', partial,
        ], { cwd: directory, timeout: 20 * 60_000, signal });
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true }).catch(() => {});
        if (error.code === 'CANCELLED') throw error;
        throw new RequestError(502, `FFmpeg no pudo montar el tramo ${done + 1} del resumen. ${error.message.split(/\r?\n/).at(-1)?.slice(0, 160) ?? ''}`.trim());
      }
    }
    done++;
    await onProgress?.({ done, total: entries.length });
  };
  const workers = Array.from({ length: Math.min(2, entries.length) }, async () => {
    while (cursor < entries.length) {
      if (signal?.aborted) throw cancelError();
      await encodePart(entries[cursor++]);
    }
  });
  await Promise.all(workers);

  await writeFile(join(workDirectory, 'list.txt'), `${entries.map(({ file }) => `file '${file}'`).join('\n')}\n`, 'utf8');
  const chapters = Array.isArray(plan.chapters) ? plan.chapters : [];
  const metadataPath = join(workDirectory, 'chapters.txt');
  if (chapters.length) {
    const marks = chapters.map(({ title, outStart }, index) => {
      const next = chapters[index + 1]?.outStart ?? plan.outputSeconds;
      return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(outStart * 1000)}\nEND=${Math.round(next * 1000)}\ntitle=${String(title).replace(/[=;#\\\n]/g, ' ')}`;
    });
    await writeFile(metadataPath, `;FFMETADATA1\n${marks.join('\n')}\n`, 'utf8');
  }
  const name = `clip-${clipNumber}`;
  const partial = join(directory, `${name}.partial.mp4`);
  try {
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', join(workDirectory, 'list.txt'),
      ...(chapters.length ? ['-i', metadataPath, '-map_chapters', '1'] : []),
      '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', partial,
    ], { cwd: directory, timeout: 60 * 60_000, signal });
    await rename(partial, join(directory, `${name}.mp4`));
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    if (error.code === 'CANCELLED') throw error;
    throw new RequestError(502, `FFmpeg no pudo unir el resumen. ${error.message.split(/\r?\n/).at(-1)?.slice(0, 160) ?? ''}`.trim());
  }
  await rm(workDirectory, { recursive: true, force: true }).catch(() => {});
  return `${name}.mp4`;
}
