import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestError } from './errors.mjs';
import { renameWithRetry } from './fsx.mjs';

// Cola FIFO persistente en .corte-data/queue.json para encolar múltiples vídeos/directos sin error 409.

const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));
export const queueFile = process.env.CORTE_QUEUE_FILE || join(dataDir, 'queue.json');

let lock = Promise.resolve();
const withLock = (fn) => {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
};

async function readRaw() {
  try {
    const parsed = JSON.parse(await readFile(queueFile, 'utf8'));
    return {
      paused: Boolean(parsed?.paused),
      items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { paused: false, items: [] };
    throw error;
  }
}

async function writeRaw(state) {
  await mkdir(dirname(queueFile), { recursive: true });
  const tmp = `${queueFile}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await renameWithRetry(tmp, queueFile);
  return state;
}

export async function loadQueue() {
  return readRaw();
}

export function enqueueJob(entry) {
  return withLock(async () => {
    const state = await readRaw();
    if (state.items.length >= 50) throw new RequestError(400, 'La cola admite como máximo 50 vídeos pendientes.');
    const item = {
      queueId: randomUUID(),
      addedAt: new Date().toISOString(),
      url: String(entry.url ?? '').trim(),
      label: String(entry.label ?? entry.url ?? '').trim().slice(0, 120),
      provider: entry.provider || 'gemini',
      model: entry.model || undefined,
      mode: ['normal', 'prototype', 'summary'].includes(entry.mode) ? entry.mode : 'normal',
      brandId: entry.brandId || undefined,
      voice: entry.voice || undefined,
      format: entry.format || undefined,
      summaryOptions: entry.summaryOptions || undefined,
    };
    if (!item.url) throw new RequestError(400, 'Se requiere una URL válida para añadir a la cola.');
    state.items.push(item);
    await writeRaw(state);
    return { item, queue: state };
  });
}

export function removeQueuedJob(queueId) {
  return withLock(async () => {
    const state = await readRaw();
    const before = state.items.length;
    state.items = state.items.filter((item) => item.queueId !== queueId);
    if (state.items.length === before) throw new RequestError(404, 'Elemento no encontrado en la cola.');
    await writeRaw(state);
    return state;
  });
}

export function setQueuePaused(paused) {
  return withLock(async () => {
    const state = await readRaw();
    state.paused = Boolean(paused);
    await writeRaw(state);
    return state;
  });
}

export function reorderQueue(orderIds) {
  return withLock(async () => {
    if (!Array.isArray(orderIds)) throw new RequestError(400, 'Se esperaba una lista de IDs.');
    const state = await readRaw();
    const byId = new Map(state.items.map((item) => [item.queueId, item]));
    const next = [];
    for (const id of orderIds) {
      if (byId.has(id)) {
        next.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) next.push(rest);
    state.items = next;
    await writeRaw(state);
    return state;
  });
}

export function popNextQueuedJob() {
  return withLock(async () => {
    const state = await readRaw();
    if (state.paused || !state.items.length) return null;
    const [next, ...rest] = state.items;
    state.items = rest;
    await writeRaw(state);
    return next;
  });
}
