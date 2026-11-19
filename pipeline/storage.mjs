import { readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestError } from './errors.mjs';
import { renameWithRetry } from './fsx.mjs';

// Gestor de disco: escanea .corte-data/jobs, libera vídeos fuente y temporales y borra proyectos.

export const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));
export const jobsDir = process.env.CORTE_JOBS_DIR || join(dataDir, 'jobs');
export const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

const sourcePattern = /^source\.[a-z0-9]+$/i;
const clipPattern = /^(?:clip-\d+\.mp4|clip-\d+-thumb\.jpg)$/i;
const tempNames = new Set(['frames', 'summary-parts', 'llama.log']);
const tempPattern = /(?:\.partial\.[a-z0-9]+|\.tmp|\.wav|\.part|\.ytdl)$|^frame-\d+-\d+\.jpg$/i;

const kindOf = (name) => (sourcePattern.test(name) ? 'source' : clipPattern.test(name) ? 'clips'
  : (tempNames.has(name) || tempPattern.test(name)) ? 'temp' : 'other');

async function size(path) {
  const info = await stat(path).catch(() => null);
  if (!info) return { bytes: 0, freeable: 0 };
  if (!info.isDirectory()) return { bytes: info.size, freeable: info.nlink > 1 ? 0 : info.size };
  let bytes = 0;
  let freeable = 0;
  for (const entry of await readdir(path).catch(() => [])) {
    const inner = await size(join(path, entry));
    bytes += inner.bytes;
    freeable += inner.freeable;
  }
  return { bytes, freeable };
}

function projectPath(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new RequestError(400, 'Identificador de proyecto no válido.');
  const path = resolve(jobsDir, id);
  if (!path.startsWith(resolve(jobsDir) + sep)) throw new RequestError(400, 'Identificador de proyecto no válido.');
  return path;
}

async function readJob(path) {
  try {
    return JSON.parse(await readFile(join(path, 'job.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function inspectProject(id) {
  const path = join(jobsDir, id);
  const job = await readJob(path);
  const info = await stat(join(path, 'job.json')).catch(() => null);
  const bytes = { source: 0, clips: 0, temp: 0, other: 0, total: 0 };
  for (const name of await readdir(path).catch(() => [])) {
    const { bytes: used } = await size(join(path, name));
    bytes[kindOf(name)] += used;
    bytes.total += used;
  }
  return {
    id, title: job?.title ?? 'Proyecto sin título', mode: job?.mode ?? 'normal', stage: job?.stage ?? 'unknown',
    clipCount: Array.isArray(job?.clips) ? job.clips.length : 0, hasSource: bytes.source > 0,
    updatedAt: info?.mtime.toISOString() ?? null, ageDays: info ? Math.floor((Date.now() - info.mtimeMs) / 86_400_000) : null, bytes,
  };
}

export async function scanStorage({ activeId = null } = {}) {
  const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    projects.push({ ...(await inspectProject(entry.name)), active: entry.name === activeId });
  }
  projects.sort((a, b) => b.bytes.total - a.bytes.total);
  const totals = { source: 0, clips: 0, temp: 0, other: 0, total: 0 };
  for (const project of projects) for (const key of Object.keys(totals)) totals[key] += project.bytes[key];
  const disk = await statfs(dataDir).catch(() => null);
  return {
    root: jobsDir, totals, projects,
    disk: disk ? { freeBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize } : null,
  };
}

/** Quita el vídeo fuente y los temporales de un proyecto y conserva clips, subtítulos, SEO y borradores. */
async function releaseSource(id) {
  const path = projectPath(id);
  let freed = 0;
  for (const name of await readdir(path).catch(() => [])) {
    if (kindOf(name) !== 'source' && kindOf(name) !== 'temp') continue;
    freed += (await size(join(path, name))).freeable;
    await rm(join(path, name), { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
  }
  const job = await readJob(path);
  if (job) {
    job.sourceReady = false;
    job.sourcePruned = true;
    const staging = join(path, 'job.prune.tmp');
    await writeFile(staging, JSON.stringify(job, null, 2), 'utf8');
    await renameWithRetry(staging, join(path, 'job.json'));
  }
  return freed;
}

/** Purga masiva. Por defecto conserva los clips y solo toca proyectos terminados con más de `olderThanDays` días. */
export async function pruneStorage({ olderThanDays = 14, keepClips = true, activeId = null } = {}) {
  const days = Number(olderThanDays);
  if (!Number.isFinite(days) || days < 0 || days > 3650) throw new RequestError(400, 'olderThanDays debe ser un número de días entre 0 y 3650.');
  const summary = { prunedProjects: 0, removedProjects: 0, freedBytes: 0, skipped: [] };
  const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    const info = await stat(join(jobsDir, entry.name, 'job.json')).catch(() => null);
    const job = info ? await readJob(join(jobsDir, entry.name)) : null;
    if (!job) { summary.skipped.push({ id: entry.name, reason: 'sin job.json' }); continue; }
    if (entry.name === activeId || !['done', 'error'].includes(job.stage)) { summary.skipped.push({ id: entry.name, reason: 'en curso' }); continue; }
    if ((Date.now() - info.mtimeMs) / 86_400_000 < days) continue;
    if (keepClips) {
      summary.freedBytes += await releaseSource(entry.name);
      summary.prunedProjects++;
    } else {
      summary.freedBytes += (await size(join(jobsDir, entry.name))).freeable;
      await rm(join(jobsDir, entry.name), { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
      summary.removedProjects++;
    }
  }
  return summary;
}

/** Borra un proyecto (o solo su fuente y temporales con keepClips). `stop` detiene el trabajo si está activo. */
export async function deleteProject(id, { keepClips = false, stop } = {}) {
  const path = projectPath(id);
  if (!(await stat(path).catch(() => null))) throw new RequestError(404, 'Este proyecto no existe.');
  await stop?.(id);
  if (keepClips) return { id, deleted: false, freedBytes: await releaseSource(id) };
  const freedBytes = (await size(path)).freeable;
  await rm(path, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
  return { id, deleted: true, freedBytes };
}
