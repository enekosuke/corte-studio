import { RequestError } from '../pipeline/errors.mjs';
import { activeJobId, stopJob } from '../pipeline/jobs.mjs';
import { deleteProject, idPattern, pruneStorage, scanStorage } from '../pipeline/storage.mjs';
import { assertLocalMutation, readJsonBody } from './context.mjs';

const jobPath = /^\/api\/jobs\/([^/]+)$/;

/** /api/health · /api/system/storage · /api/system/storage/prune · DELETE /api/jobs/:id. */
export async function handleSystemRoute({ request, response, pathname, searchParams, origin, sendJson }) {
  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, activeJobId: activeJobId() });
    return true;
  }
  if (pathname === '/api/system/storage' && request.method === 'GET') {
    sendJson(response, 200, await scanStorage({ activeId: activeJobId() }));
    return true;
  }
  if (pathname === '/api/system/storage/prune' && request.method === 'POST') {
    const body = await readJsonBody(request, origin, 1024);
    sendJson(response, 200, await pruneStorage({
      olderThanDays: body.olderThanDays ?? 14,
      keepClips: body.keepClips !== false,
      activeId: activeJobId(),
    }));
    return true;
  }
  const match = jobPath.exec(pathname);
  if (match && request.method === 'DELETE') {
    assertLocalMutation(request, origin);
    if (!idPattern.test(match[1])) throw new RequestError(400, 'Identificador de proyecto no válido.');
    sendJson(response, 200, await deleteProject(match[1], { keepClips: searchParams.get('keepClips') === 'true', stop: stopJob }));
    return true;
  }
  return false;
}
