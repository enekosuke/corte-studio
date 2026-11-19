import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { createTailnetProxy, forwardableHeaders } from '../scripts/corte-tailnet-proxy.mjs';

const authority = 'pc-prueba.tail1234.ts.net';
const login = 'yo@example.com';
const origin = `https://${authority}`;

async function setup(t) {
  const seen = [];
  const upstream = createServer((incoming, outgoing) => {
    let body = '';
    incoming.on('data', (chunk) => { body += chunk; });
    incoming.on('end', () => {
      seen.push({ method: incoming.method, url: incoming.url, headers: incoming.headers, body });
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = createTailnetProxy(async () => ({ authority, login }), { upstream: `127.0.0.1:${upstream.address().port}` });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.close(); proxy.close(); });
  const send = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port: proxy.address().port, method, path, headers: {
      host: authority, 'x-forwarded-proto': 'https', 'tailscale-user-login': login, ...headers,
    } }, (reply) => {
      let text = '';
      reply.on('data', (chunk) => { text += chunk; });
      reply.on('end', () => resolve({ status: reply.statusCode, text }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
  return { send, seen };
}

test('el proxy deja pasar GET, POST, DELETE y PATCH del propio túnel y rechaza el resto', async (t) => {
  const { send, seen } = await setup(t);
  const same = { origin, 'content-type': 'application/json' };
  assert.equal((await send('GET', '/api/brands')).status, 200);
  assert.equal((await send('HEAD', '/')).status, 200);
  assert.equal((await send('POST', '/api/brands', { headers: same, body: '{"id":"x"}' })).status, 200);
  assert.equal((await send('DELETE', '/api/jobs/00000000-0000-4000-8000-000000000000?keepClips=true', { headers: { origin } })).status, 200);
  assert.equal((await send('PATCH', '/api/jobs/x/clips/clip-1.mp4', { headers: same, body: '{}' })).status, 200);
  assert.deepEqual(seen.map(({ method }) => method), ['GET', 'HEAD', 'POST', 'DELETE', 'PATCH']);
  assert.equal(seen[3].url, '/api/jobs/00000000-0000-4000-8000-000000000000?keepClips=true', 'la consulta llega intacta');
  assert.equal(seen[2].body, '{"id":"x"}');
  for (const method of ['PUT', 'OPTIONS', 'TRACE']) assert.equal((await send(method, '/api/brands', { headers: { origin } })).status, 400, method);
  assert.equal((await send('GET', '//evil.example/x')).status, 400);
});

test('el proxy exige la cuenta de Tailscale y el origen del túnel en todo lo que modifica datos', async (t) => {
  const { send, seen } = await setup(t);
  assert.equal((await send('DELETE', '/api/jobs/x')).status, 403, 'sin origen');
  assert.equal((await send('DELETE', '/api/jobs/x', { headers: { origin: 'https://otro.example' } })).status, 403);
  assert.equal((await send('PATCH', '/api/x', { headers: { origin: 'http://127.0.0.1:4173' } })).status, 403);
  assert.equal((await send('GET', '/api/brands', { headers: { 'tailscale-user-login': 'intruso@example.com' } })).status, 403);
  assert.equal((await send('POST', '/api/x', { headers: { origin, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await send('GET', '/api/brands', { headers: { host: 'otra.host' } })).status, 403);
  assert.equal(seen.length, 0, 'nada de eso llega al estudio');
});

test('las cabeceras nuevas de la API pasan y las del túnel y las credenciales no', async (t) => {
  const { send, seen } = await setup(t);
  await send('POST', '/api/jobs/upload', { headers: {
    origin, 'content-type': 'video/mp4', 'x-file-name': 'partida.mp4', 'x-brand-id': 'risawow', cookie: 'sesion=1', authorization: 'Bearer secreto', referer: 'https://x.example/',
  }, body: 'datos' });
  const [call] = seen;
  assert.equal(call.headers['x-file-name'], 'partida.mp4');
  assert.equal(call.headers['x-brand-id'], 'risawow');
  assert.equal(call.headers['content-type'], 'video/mp4');
  assert.equal(call.headers.host, '127.0.0.1:4173', 'el estudio sigue viendo su dirección local');
  assert.equal(call.headers.origin, 'http://127.0.0.1:4173');
  for (const blocked of ['cookie', 'authorization', 'referer', 'tailscale-user-login', 'x-forwarded-proto']) assert.equal(call.headers[blocked], undefined, blocked);
  assert.equal(call.body, 'datos');
  assert.deepEqual(forwardableHeaders({ origin: 'https://otro.example', 'x-a': '1' }, origin), { host: '127.0.0.1:4173', 'x-a': '1' });
});
