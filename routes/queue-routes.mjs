import youtube from '../dist/youtube.js';
import { RequestError } from '../pipeline/errors.mjs';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { enqueueJob, loadQueue, removeQueuedJob, reorderQueue, setQueuePaused } from '../pipeline/queue.mjs';
import { assertLocalMutation, readJsonBody } from './context.mjs';

const itemPath = /^\/api\/queue\/([a-f0-9-]{8,40})$/;

/** GET/POST /api/queue · DELETE /api/queue/:queueId · POST /api/queue/pause · POST /api/queue/reorder. */
export async function handleQueueRoute({ request, response, pathname, origin, sendJson, onQueueChanged }) {
  if (pathname === '/api/queue') {
    if (request.method === 'GET') {
      sendJson(response, 200, await loadQueue());
      return true;
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request, origin, 5000);
      const source = typeof body.url === 'string' && youtube.parseVideoSource(body.url.trim());
      if (!source) throw new RequestError(400, 'Introduce un enlace válido de YouTube o Twitch para añadir a la cola.');
      const format = body.format ? normalizeFormat(body.format) : undefined;
      const result = await enqueueJob({
        url: source.url,
        label: source.label || source.url,
        provider: body.provider || 'gemini',
        model: body.model,
        mode: body.mode || 'normal',
        brandId: body.brandId,
        voice: body.voice,
        format,
        summaryOptions: body.summaryOptions,
      });
      if (typeof onQueueChanged === 'function') void onQueueChanged();
      sendJson(response, 201, result);
      return true;
    }
    throw new RequestError(405, 'Método no disponible.');
  }
  if (pathname === '/api/queue/pause' && request.method === 'POST') {
    const body = await readJsonBody(request, origin, 1024);
    const state = await setQueuePaused(body.paused === true);
    if (!state.paused && typeof onQueueChanged === 'function') void onQueueChanged();
    sendJson(response, 200, state);
    return true;
  }
  if (pathname === '/api/queue/reorder' && request.method === 'POST') {
    const body = await readJsonBody(request, origin, 4096);
    const state = await reorderQueue(body.order);
    sendJson(response, 200, state);
    return true;
  }
  const match = itemPath.exec(pathname);
  if (match && request.method === 'DELETE') {
    assertLocalMutation(request, origin);
    sendJson(response, 200, await removeQueuedJob(match[1]));
    return true;
  }
  return false;
}
