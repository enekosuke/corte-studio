import { RequestError } from '../pipeline/errors.mjs';

// Utilidades comunes a las rutas: comprobación de origen local y lectura de cuerpos con límite de tamaño.

export function assertLocalMutation(request, origin) {
  if (request.headers.origin !== origin) throw new RequestError(403, 'Esta acción solo está disponible desde la página local del estudio.');
}

export async function readBuffer(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new RequestError(413, 'La petición es demasiado grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(request, origin, limit = 4096) {
  assertLocalMutation(request, origin);
  if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) throw new RequestError(400, 'Se esperaba application/json.');
  const raw = (await readBuffer(request, limit)).toString('utf8');
  try { return JSON.parse(raw || '{}') ?? {}; } catch { throw new RequestError(400, 'Se esperaba un objeto JSON.'); }
}
