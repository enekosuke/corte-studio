import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dataDir } from './media.mjs';
import { renameWithRetry } from './fsx.mjs';

// Copia local de todos los vídeos terminados: Descargas\Vídeos\<proyecto>\<clips>.mp4
// Se usan enlaces duros cuando es posible (no ocupan espacio extra) y copia normal si no.

export const exportRoot = process.env.CORTE_EXPORT_DIR || join(homedir(), 'Downloads', 'Vídeos');
const jobsDir = join(dataDir, 'jobs');
const indexPath = process.env.CORTE_EXPORT_INDEX || join(dataDir, 'export-index.json');
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
let queue = Promise.resolve();

/** Nombre válido en Windows: sin caracteres prohibidos, sin puntos ni espacios finales y de longitud acotada. */
export function safeName(value, fallback = 'Sin título', max = 80) {
  let name = String(value ?? '')
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}‍️]/gu, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*�]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/g, '');
  if (!name || reserved.test(name)) name = fallback;
  return name;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function linkOrCopy(source, target) {
  try {
    await link(source, target);
  } catch {
    await copyFile(source, target);
  }
}

async function placeFile(source, target) {
  const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
  if (to && to.size === from.size && (to.ino === from.ino || to.mtimeMs >= from.mtimeMs)) return false;
  if (to) await rm(target, { force: true });
  await linkOrCopy(source, target);
  return true;
}

export function clipFileName(clip, count) {
  const number = /^clip-(\d+)\.mp4$/.exec(clip.file)?.[1];
  const title = safeName(clip.title, `Clip ${number ?? ''}`.trim(), 90);
  if (clip.summary || count === 1) return `${title}.mp4`;
  return `${String(number ?? '').padStart(2, '0')} - ${title}.mp4`;
}

/** Carpeta del proyecto: el título, y con la fecha si otro proyecto ya usa el mismo nombre. */
function assignFolder(index, job, takenBy) {
  if (index[job.id]) return index[job.id];
  const base = safeName(job.title, 'Proyecto', 80);
  let folder = base;
  const owner = takenBy.get(folder.toLowerCase());
  if (owner && owner !== job.id) {
    const stamp = new Date(job.updatedAt ?? Date.now()).toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    folder = `${base} (${stamp})`;
    let n = 2;
    while (takenBy.has(folder.toLowerCase()) && takenBy.get(folder.toLowerCase()) !== job.id) folder = `${base} (${stamp}) ${n++}`;
  }
  index[job.id] = folder;
  takenBy.set(folder.toLowerCase(), job.id);
  return folder;
}

async function loadIndex() {
  const index = (await readJson(indexPath)) ?? {};
  const takenBy = new Map(Object.entries(index).map(([id, folder]) => [folder.toLowerCase(), id]));
  return { index, takenBy };
}

async function saveIndex(index) {
  const staging = `${indexPath}.tmp`;
  await writeFile(staging, JSON.stringify(index, null, 2), 'utf8');
  await renameWithRetry(staging, indexPath);
}

async function exportJob(job, directory, state) {
  const clips = (job.clips ?? []).filter((clip) => /^clip-\d+\.mp4$/.test(clip.file));
  const present = [];
  for (const clip of clips) if (await exists(join(directory, clip.file))) present.push(clip);
  if (!present.length) return { folder: null, files: 0 };
  const folder = assignFolder(state.index, job, state.takenBy);
  const target = join(exportRoot, folder);
  await mkdir(target, { recursive: true });
  let files = 0;
  for (const clip of present) {
    if (await placeFile(join(directory, clip.file), join(target, clipFileName(clip, present.length)))) files++;
  }
  return { folder: target, files };
}

/** Exporta un proyecto concreto. Nunca lanza: un fallo de copia no debe romper el trabajo. */
export function exportJobClips(job) {
  const run = async () => {
    const state = await loadIndex();
    const result = await exportJob(job, join(jobsDir, job.id), state);
    await saveIndex(state.index);
    return result;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

/** Recorre todos los proyectos guardados y deja su carpeta al día. */
export function exportAllProjects() {
  const run = async () => {
    const state = await loadIndex();
    const entries = await readdir(jobsDir, { withFileTypes: true }).catch(() => []);
    let projects = 0;
    let files = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
      const directory = join(jobsDir, entry.name);
      const job = await readJson(join(directory, 'job.json'));
      if (!job?.id || !Array.isArray(job.clips)) continue;
      try {
        const { updatedAt } = await stat(join(directory, 'job.json')).then(({ mtime }) => ({ updatedAt: mtime.toISOString() }));
        const result = await exportJob({ ...job, updatedAt }, directory, state);
        if (result.folder) projects++;
        files += result.files;
      } catch (error) {
        console.warn(`No se pudo copiar el proyecto ${entry.name} a ${exportRoot}:`, error.message);
      }
    }
    await saveIndex(state.index);
    return { folder: exportRoot, projects, files };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
