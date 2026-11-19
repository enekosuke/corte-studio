import { RequestError } from '../pipeline/errors.mjs';
import { deleteBrand, loadBrands, saveBrand, saveBrandLogo } from '../pipeline/brands.mjs';
import { assertLocalMutation, readBuffer, readJsonBody } from './context.mjs';

const brandPath = /^\/api\/brands\/([a-z0-9][a-z0-9-]{1,39})(\/logo)?$/;

/** GET/POST /api/brands · DELETE /api/brands/:id · POST /api/brands/:id/logo. Devuelve true si atendió la ruta. */
export async function handleBrandsRoute({ request, response, pathname, origin, sendJson }) {
  if (pathname === '/api/brands') {
    if (request.method === 'GET') {
      sendJson(response, 200, await loadBrands());
      return true;
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request, origin, 8192);
      const brand = await saveBrand(body.brand ?? body, { makeDefault: body.makeDefault === true });
      sendJson(response, 200, { brand, ...(await loadBrands()) });
      return true;
    }
    throw new RequestError(405, 'Método no disponible.');
  }
  const match = brandPath.exec(pathname);
  if (!match) return false;
  const [, id, logo] = match;
  if (logo) {
    if (request.method !== 'POST') throw new RequestError(405, 'Método no disponible.');
    assertLocalMutation(request, origin);
    if (!/^image\/png\b/i.test(request.headers['content-type'] ?? '')) throw new RequestError(400, 'Envía el logo como image/png.');
    const brand = await saveBrandLogo(id, await readBuffer(request, 1024 * 1024 + 1));
    sendJson(response, 200, { brand });
    return true;
  }
  if (request.method === 'DELETE') {
    assertLocalMutation(request, origin);
    sendJson(response, 200, await deleteBrand(id));
    return true;
  }
  throw new RequestError(405, 'Método no disponible.');
}
