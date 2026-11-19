import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { pathToFileURL } from 'node:url';

const studioHost = '127.0.0.1:4173';
const configFile = new URL('../.corte-data/remote-access.json', import.meta.url);
const hopByHopHeaders = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'trailer'];
// Métodos que usa la API del estudio. Todos los que modifican datos exigen además el origen del propio túnel.
const readMethods = new Set(['GET', 'HEAD']);
const writeMethods = new Set(['POST', 'DELETE', 'PATCH']);
// Cabeceras que NO se reenvían al estudio: las propias del túnel, las que identifican al navegador y las credenciales.
// Todo lo demás pasa, así una cabecera nueva de la API (por ejemplo X-File-Name) funciona sin tocar el proxy.
const blockedHeaders = /^(?:host|origin|referer|cookie|authorization|proxy-.*|tailscale-.*|x-forwarded-.*|x-real-ip|forwarded|sec-.*|connection|keep-alive|transfer-encoding|upgrade|te|trailer)$/i;

export function forwardableHeaders(incomingHeaders, origin) {
  const headers = { host: studioHost };
  if (incomingHeaders.origin === origin) headers.origin = `http://${studioHost}`;
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (value !== undefined && !blockedHeaders.test(name)) headers[name] = value;
  }
  return headers;
}

/** `upstream` permite apuntar a otro puerto (pruebas); el estudio siempre recibe Host 127.0.0.1:4173. */
export function createTailnetProxy(loadConfig = async () => JSON.parse(await readFile(configFile, 'utf8')), { upstream = studioHost } = {}) {
  return createServer(async (incoming, outgoing) => {
    const reject = (status, message) => {
      outgoing.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      outgoing.end(message);
    };

    try {
      const { authority, login } = await loadConfig();
      if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net(?::8443)?$/.test(authority) || !login) {
        return reject(503, 'El acceso remoto de Corte Studio no está configurado.');
      }

      const { headers: incomingHeaders, method, url } = incoming;
      const origin = `https://${authority}`;
      const readOnly = readMethods.has(method);
      const navigation = readOnly && incomingHeaders['sec-fetch-mode'] === 'navigate' &&
        incomingHeaders['sec-fetch-dest'] === 'document';
      if (incomingHeaders.host !== authority || incomingHeaders['x-forwarded-proto'] !== 'https' ||
          incomingHeaders['tailscale-user-login']?.toLowerCase() !== login.toLowerCase() ||
          (incomingHeaders['sec-fetch-site'] === 'cross-site' && !navigation) ||
          ((incomingHeaders.origin || !readOnly) && incomingHeaders.origin !== origin)) {
        return reject(403, 'Abre Corte Studio desde un equipo conectado con tu cuenta de Tailscale.');
      }
      if ((!readOnly && !writeMethods.has(method)) || !url?.startsWith('/') || url.startsWith('//')) {
        return reject(400, 'Solicitud no admitida.');
      }
      if (url === '/__corte_proxy_check') return reject(200, 'Corte Studio');

      const headers = forwardableHeaders(incomingHeaders, origin);
      const [upstreamHost, upstreamPort] = upstream.split(':');
      const upstreamRequest = request({ host: upstreamHost, port: Number(upstreamPort), method, path: url, headers, agent: false }, (reply) => {
        for (const name of hopByHopHeaders) delete reply.headers[name];
        outgoing.writeHead(reply.statusCode, reply.headers);
        reply.on('error', (error) => outgoing.destroy(error));
        reply.pipe(outgoing);
      });
      upstreamRequest.on('error', (error) => {
        if (outgoing.headersSent) outgoing.destroy(error);
        else reject(502, 'El servidor local de Corte Studio no responde.');
      });
      outgoing.on('close', () => upstreamRequest.destroy());
      incoming.pipe(upstreamRequest);
    } catch {
      reject(503, 'El acceso remoto de Corte Studio no está configurado.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createTailnetProxy().listen(4176, '127.0.0.1');
}
