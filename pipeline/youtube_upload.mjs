import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RequestError } from './errors.mjs';
import { getJob, jobDirectory, readCheckpoint } from './jobs.mjs';
import { dataDir } from './media.mjs';
import { getBrand } from './brands.mjs';
import { renameWithRetry } from './fsx.mjs';
import { analyzeAndSaveClipSeo, inferGameContext } from './publication.mjs';

export const clientSecretPath = join(dataDir, 'youtube-client-secret.json');
export const tokenPath = join(dataDir, 'youtube-token.json');
const channelsDir = join(dataDir, 'youtube-channels');
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const hour = 3_600_000;
let publicationTail = Promise.resolve();

async function withPublicationQueue(publish) {
  const previous = publicationTail;
  let release;
  publicationTail = new Promise((resolve) => { release = resolve; });
  try {
    await previous;
    return await publish();
  } finally {
    release();
  }
}

async function loadClientCredentials(customSecretPath = clientSecretPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(customSecretPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new RequestError(400, `Falta el archivo OAuth oficial de Google Cloud en ${customSecretPath}.`);
    }
    throw error;
  }
  const inner = raw.installed ?? raw.web ?? raw;
  const client_id = inner?.client_id || inner?.clientId;
  const client_secret = inner?.client_secret || inner?.clientSecret;
  const redirect_uris = Array.isArray(inner?.redirect_uris)
    ? inner.redirect_uris
    : (inner?.redirectUri || inner?.redirect_uri ? [inner.redirectUri || inner.redirect_uri] : []);
  if (!client_id || !client_secret) {
    throw new RequestError(400, 'El archivo de credenciales OAuth no contiene client_id y client_secret válidos.');
  }
  return {
    ...inner,
    client_id,
    client_secret,
    redirect_uris,
  };
}

function openBrowserUrl(url) {
  if (process.platform === 'win32') {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

function pickLocalRedirect(creds) {
  const candidates = Array.isArray(creds.redirect_uris) ? creds.redirect_uris : [];
  for (const raw of candidates) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        return {
          hostname: parsed.hostname,
          port: Number(parsed.port) || 80,
          pathname: parsed.pathname || '/',
          exactUri: raw,
        };
      }
    } catch { /* skip */ }
  }
  return { hostname: '127.0.0.1', port: 0, pathname: '/', exactUri: null };
}

async function authorizeInteractive(creds, loginHint, { open = true } = {}) {
  const target = pickLocalRedirect(creds);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let server;
  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new RequestError(408, 'Tiempo de espera agotado esperando autorización OAuth en el navegador.'));
    }, 5 * 60_000);

    let boundUri = target.exactUri;
    server = createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://${target.hostname}:${target.port || 80}`);
      if (req.method !== 'GET' || reqUrl.pathname !== target.pathname || reqUrl.searchParams.get('state') !== state) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const authCode = reqUrl.searchParams.get('code');
      const authError = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authCode
        ? '<h2>Corte Studio ha recibido la autorización de Google.</h2>'
        : '<h2>Autorización cancelada.</h2>');
      clearTimeout(timer);
      server.close();
      if (authCode) resolve({ code: authCode, redirectUri: boundUri });
      else reject(new RequestError(401, `Autorización denegada por el usuario: ${authError || 'desconocido'}`));
    });
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(new RequestError(500, `No se pudo abrir el puerto local OAuth (${target.hostname}:${target.port}): ${err.message}`));
    });
    server.listen(target.port, target.hostname === 'localhost' ? '127.0.0.1' : target.hostname, () => {
      const port = server.address().port;
      boundUri = target.exactUri ?? `http://127.0.0.1:${port}`;
      const authUrl = new URL(creds.auth_uri || 'https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', creds.client_id);
      authUrl.searchParams.set('redirect_uri', boundUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', UPLOAD_SCOPE);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', loginHint ? 'consent' : 'select_account consent');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      authUrl.searchParams.set('code_challenge_method', 'S256');
      if (loginHint) authUrl.searchParams.set('login_hint', loginHint);
      console.error(`CORTE_AUTH_URL:${authUrl.toString()}`);
      if (open) openBrowserUrl(authUrl.toString());
    });
  });

  const tokenRes = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    throw new RequestError(401, `No se pudo intercambiar el código OAuth: ${tokens.error_description || tokens.error || tokenRes.status}`);
  }
  return { ...tokens, clientId: creds.client_id, obtainedAt: Date.now() };
}

async function getAccessToken(customSecretPath = clientSecretPath, loginHint, { savedPath = tokenPath, interactive = true } = {}) {
  const creds = await loadClientCredentials(customSecretPath);
  const saved = await readFile(savedPath, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
  const existing = saved?.clientId && saved.clientId !== creds.client_id ? null : saved;
  const validUntil = existing?.expiry_date ?? (existing?.obtainedAt ? existing.obtainedAt + (existing.expires_in || 3500) * 1000 : 0);
  if (existing?.access_token && (validUntil - 60_000) > Date.now()) {
    return existing.access_token;
  }
  if (existing?.refresh_token) {
    const res = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: existing.refresh_token,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        grant_type: 'refresh_token',
      }),
    });
    const refreshed = await res.json();
    if (res.ok && refreshed.access_token) {
      const merged = { ...existing, ...refreshed, obtainedAt: Date.now() };
      delete merged.expiry_date;
      await writeUploadJson(savedPath, merged);
      return merged.access_token;
    }
  }
  if (!interactive) throw new RequestError(401, 'Vuelve a autorizar este canal de YouTube.');
  const fresh = await authorizeInteractive(creds, loginHint);
  await mkdir(dataDir, { recursive: true });
  await writeUploadJson(savedPath, fresh);
  return fresh.access_token;
}

function channelFiles(channelId) {
  if (!channelIdPattern.test(channelId)) throw new RequestError(400, 'El identificador del canal de YouTube no es válido.');
  const directory = join(channelsDir, channelId);
  return { directory, credentials: join(directory, 'youtube-client-secret.json'), token: join(directory, 'youtube-token.json') };
}

async function resolveUploadChannel(channelId, { includeUploads = false, secretPath = clientSecretPath, loginHint } = {}) {
  const profile = channelId ? channelFiles(channelId) : null;
  const saved = profile && await readCheckpoint(profile.directory, 'youtube-token.json');
  const accessToken = saved
    ? await getAccessToken(profile.credentials, undefined, { savedPath: profile.token, interactive: false })
    : await getAccessToken(secretPath, loginHint, { interactive: !channelId });
  const channel = await describeChannel(accessToken, { includeUploads });
  if (channelId && channel.channelId !== channelId) {
    throw new RequestError(409, 'La autorización no corresponde al canal elegido. Selecciona o conecta el canal correcto.');
  }
  return { ...channel, accessToken };
}

async function describeChannel(token, { includeUploads = false } = {}) {
  const part = includeUploads ? 'snippet,contentDetails' : 'snippet';
  const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=${part}&mine=true`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new RequestError(502, `YouTube no pudo verificar el canal (HTTP ${response.status}).`);
  const item = (await response.json()).items?.[0];
  if (!item?.id) throw new RequestError(401, 'No se encontró un canal de YouTube asociado a la autorización.');
  return {
    channelId: item.id, title: item.snippet?.title || 'YouTube', handle: item.snippet?.customUrl || '',
    ...(includeUploads ? { uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads } : {}),
  };
}

export async function getLatestScheduledUpload(token, uploadsPlaylistId, { now = Date.now(), signal, fetcher = fetch } = {}) {
  if (!uploadsPlaylistId) throw new RequestError(502, 'YouTube no devolvió la lista de subidas del canal.');
  const read = async (resource, params) => {
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetcher(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new RequestError(502, `No se pudo comprobar la cola del canal de YouTube (HTTP ${response.status}).`);
    return response.json();
  };
  let latest = null;
  let pageToken;
  do {
    const page = await read('playlistItems', {
      part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: '50',
      fields: 'nextPageToken,items(contentDetails/videoId)', ...(pageToken ? { pageToken } : {}),
    });
    const ids = (page.items ?? []).map((item) => item.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const videos = await read('videos', { part: 'status', id: ids.join(','), fields: 'items(status(privacyStatus,publishAt))' });
      for (const { status } of videos.items ?? []) {
        const time = Date.parse(status?.publishAt);
        if (status?.privacyStatus === 'private' && time > now && time > (latest ?? now)) latest = time;
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return latest;
}

export function nextPublishDate({ intervalHours, latest = null, startAtIso, now = Date.now() }) {
  const defaultStart = Math.ceil((now + 15 * 60_000) / hour) * hour;
  const requestedStart = startAtIso ? Date.parse(startAtIso) : defaultStart;
  if (!Number.isFinite(requestedStart)) throw new RequestError(400, 'La fecha de inicio de publicación no es válida.');
  const afterQueue = latest === null ? 0 : latest + intervalHours * hour;
  return new Date(Math.max(now + 15 * 60_000, requestedStart, afterQueue)).toISOString();
}

async function verifyNewConnection(secretPath) {
  const credentials = await loadClientCredentials(secretPath);
  const tokens = await authorizeInteractive(credentials, undefined, { open: false });
  const channel = await describeChannel(tokens.access_token);
  const staging = await mkdtemp(join(dataDir, 'youtube-connection-'));
  await copyFile(secretPath, join(staging, 'youtube-client-secret.json'));
  await writeFile(join(staging, 'youtube-token.json'), JSON.stringify({ ...tokens, channelId: channel.channelId }, null, 2), 'utf8');
  return { ...channel, staging };
}

async function storeChannel(channel, secretPath, tokens) {
  const profile = channelFiles(channel.channelId);
  await mkdir(profile.directory, { recursive: true });
  // Commit credentials before writing the token used to discover the profile.
  await writeUploadJson(profile.credentials, JSON.parse(await readFile(secretPath, 'utf8')));
  await writeUploadJson(profile.token, { ...tokens, channelId: channel.channelId });
  return channel;
}

let channelConnection = { running: false };
export function getYouTubeChannelConnection() {
  return channelConnection;
}

export function connectYouTubeChannel() {
  if (channelConnection.running) return channelConnection;
  channelConnection = { running: true, message: 'Autoriza el canal en el navegador del PC que aloja Corte Studio.' };
  void (async () => {
    try {
      const creds = await loadClientCredentials();
      const tokens = await authorizeInteractive(creds);
      const channel = await describeChannel(tokens.access_token);
      await storeChannel(channel, clientSecretPath, tokens);
      channelConnection = { running: false, channel, message: `Canal conectado: ${channel.title}.` };
    } catch (error) {
      channelConnection = { running: false, error: error.status ? error.message : 'No se pudo conectar el canal de YouTube.' };
    }
  })();
  return channelConnection;
}

/**
 * Return cached YouTube uploads map (`clip-N.mp4 -> upload record`) for a job.
 */
export async function getJobUploads(directory) {
  return (await readCheckpoint(directory, 'youtube-uploads.json')) ?? {};
}

/**
 * Inspect whether YouTube Data API v3 OAuth credentials and a valid token exist
 * for uploading without prompting, resolving the active channel title & handle.
 */
export async function getYouTubeConnectionStatus(customSecretPath = clientSecretPath) {
  let legacy;
  let reason;
  let hasCredentials = false;
  try {
    await loadClientCredentials(customSecretPath);
    hasCredentials = true;
    legacy = await describeChannel(await getAccessToken(customSecretPath, undefined, { interactive: false }));
  } catch (err) {
    reason = err.status ? err.message : 'No se pudo comprobar la conexión con YouTube.';
  }
  const directories = await readdir(channelsDir, { withFileTypes: true }).catch(() => []);
  const registered = await Promise.all(directories.filter((entry) => entry.isDirectory() && channelIdPattern.test(entry.name)).map(async ({ name }) => {
    try {
      const { accessToken: _token, ...channel } = await resolveUploadChannel(name);
      return channel;
    } catch { return null; }
  }));
  const channels = [...new Map([legacy, ...registered].filter(Boolean).map((channel) => [channel.channelId, channel])).values()];
  return { connected: channels.length > 0, hasCredentials, channels, ...channels[0], ...(channels.length ? {} : { reason }) };
}

/**
 * Format YouTube snippet + scheduled status from Corte Studio publication SEO JSON.
 */
export function buildVideoMetadata(clip, seo, publishAtIso, draft, sourceTitle = '') {
  const yt = seo?.platforms?.youtube ?? {};
  const gameCtx = inferGameContext(sourceTitle, clip, yt.text || seo?.hook || '', seo?.game || '');
  const longForm = Boolean(clip.longForm);
  const rawTitle = draft?.title || yt.title || (longForm ? clip.title : `${clip.title} #Shorts`);
  const title = longForm || /#shorts/i.test(rawTitle) ? rawTitle.slice(0, 100) : `${rawTitle.slice(0, 91).trim()} #Shorts`;
  const draftTags = Array.isArray(draft?.hashtags) ? draft.hashtags.map((h) => String(h).replace(/^#/, '')) : [];
  const gameTags = (gameCtx?.hashtags ?? []).map((h) => h.replace(/^#/, ''));
  const ytTags = Array.isArray(yt.hashtags) ? yt.hashtags.map((h) => h.replace(/^#/, '')) : [];
  const orderedHashNames = [];
  const seenHash = new Set();
  for (const tag of [...gameTags, ...(draftTags.length ? draftTags : ytTags), ...(longForm ? [] : ['Shorts'])]) {
    const clean = String(tag || '').replace(/^#/, '').trim();
    const key = clean.toLowerCase();
    if (clean && !seenHash.has(key)) {
      seenHash.add(key);
      orderedHashNames.push(clean);
    }
  }
  const tags = [...new Set([
    ...(Array.isArray(seo?.seoKeywords) ? seo.seoKeywords : []),
    ...(gameCtx?.keywords ?? []),
    ...orderedHashNames,
  ])].filter(Boolean).slice(0, 18);
  const bodyText = draft?.text || yt.text || clip.title;
  const gameHeader = gameCtx?.name && !bodyText.toLowerCase().includes(gameCtx.name.toLowerCase())
    ? `Juego: ${gameCtx.name}`
    : '';
  const hashLine = orderedHashNames.slice(0, 6).map((t) => `#${t}`).join(' ');
  const descriptionParts = [
    seo?.hook,
    bodyText,
    gameHeader,
    seo?.pinnedComment ? `\n${seo.pinnedComment}` : '',
    `\n${hashLine}`,
  ].filter(Boolean);

  return {
    snippet: {
      title,
      description: descriptionParts.join('\n').slice(0, 4900),
      tags,
      categoryId: gameCtx ? '20' : '24', // 20 = Gaming, 24 = Entertainment
      defaultLanguage: 'es',
      defaultAudioLanguage: 'es',
    },
    status: {
      ...(publishAtIso ? { privacyStatus: 'private', publishAt: publishAtIso } : { privacyStatus: 'public' }),
      selfDeclaredMadeForKids: false,
    },
  };
}

const retryableUploadStatus = new Set([408, 429, 500, 502, 503, 504]);

async function uploadFailure(response, stage) {
  const body = await response.text();
  let reason;
  try { reason = JSON.parse(body).error?.errors?.find(({ reason }) => reason === 'uploadLimitExceeded')?.reason; } catch {}
  if (reason) {
    return new RequestError(400, 'Este canal alcanzó el límite diario de subidas de YouTube. Los clips ya subidos se conservan. Vuelve a intentarlo en 24 horas.', reason);
  }
  return new RequestError(response.status, `YouTube rechazó ${stage} (HTTP ${response.status}): ${body.slice(0, 300)}`);
}

async function writeUploadJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await renameWithRetry(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function uploadSingleClip(accessToken, filePath, metadata, { channelId, signal, fetcher = fetch, wait = delay } = {}) {
  const { size, mtimeMs } = await stat(filePath);
  if (!size) throw new RequestError(422, 'El archivo del clip está vacío.');
  const legacyPath = `${filePath}.youtube-session.json`;
  let sessionPath = channelIdPattern.test(channelId) ? `${filePath}.youtube-session-${channelId}.json` : legacyPath;
  let session = await readCheckpoint(dirname(sessionPath), basename(sessionPath));
  if (!session && sessionPath !== legacyPath) {
    const legacy = await readCheckpoint(dirname(legacyPath), basename(legacyPath));
    if (legacy?.channelId === channelId) {
      session = legacy;
      sessionPath = legacyPath;
    }
  }
  if (session && (session.size !== size || session.mtimeMs !== mtimeMs || session.channelId !== channelId)) {
    throw new RequestError(409, 'La sesión de subida corresponde a otro canal o a otra versión del clip.');
  }
  const auth = { Authorization: `Bearer ${accessToken}` };
  let retries = 0;
  let offset = 0;
  let probe = Boolean(session);
  const request = (url, options) => {
    const timeout = AbortSignal.timeout(300_000);
    return fetcher(url, { ...options, redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };
  const pause = async (response, error) => {
    const retryAfter = response?.headers.get('retry-after');
    await response?.body?.cancel().catch(() => {});
    signal?.throwIfAborted();
    if (retries >= 5) {
      const detail = error?.cause?.code || (response ? `HTTP ${response.status}` : error?.name || 'conexión');
      throw new RequestError(502, `La subida a YouTube se interrumpió (${detail}). Puedes reanudar desde Publicación rápida.`);
    }
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
    await wait(Math.min(30_000, Math.max(seconds * 1000, 1000 * 2 ** retries++)), undefined, { signal });
  };

  while (true) {
    if (!session) {
      let response;
      try {
        response = await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
          body: JSON.stringify(metadata),
        });
      } catch (error) { await pause(null, error); continue; }
      if (retryableUploadStatus.has(response.status)) { await pause(response); continue; }
      if (!response.ok) throw await uploadFailure(response, 'el inicio de subida');
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new RequestError(502, 'YouTube no devolvió una sesión de subida.');
      session = { location, size, mtimeMs, channelId, metadata };
      await writeUploadJson(sessionPath, session);
      offset = 0;
      probe = false;
    }

    const url = new URL(session.location);
    if (url.protocol !== 'https:' || !['www.googleapis.com', 'upload.youtube.com'].includes(url.hostname)) throw new RequestError(502, 'YouTube devolvió una dirección de subida inesperada.');
    const stream = probe ? undefined : createReadStream(filePath, { start: offset });
    const range = probe ? `bytes */${size}` : `bytes ${offset}-${size - 1}/${size}`;
    let response;
    try {
      response = await request(url, {
        method: 'PUT', headers: { ...auth, 'Content-Range': range, 'Content-Length': String(probe ? 0 : size - offset), 'Content-Type': 'video/mp4' },
        ...(stream ? { body: stream, duplex: 'half' } : { body: '' }),
      });
    } catch (error) {
      await pause(null, error);
      probe = true;
      continue;
    } finally { stream?.destroy(); }

    if (retryableUploadStatus.has(response.status)) { await pause(response); probe = true; continue; }
    if (response.status === 308) {
      const accepted = response.headers.get('range');
      const match = accepted && /^bytes=0-(\d+)$/.exec(accepted);
      const received = match ? Number(match[1]) + 1 : 0;
      if ((accepted && !match) || !Number.isSafeInteger(received) || received > size) throw new RequestError(502, 'YouTube devolvió un intervalo de subida inválido.');
      // Recover completed uploads before replacing a stale slot on an incomplete upload.
      const requestedDate = metadata.status.publishAt;
      const savedDate = session.metadata.status.publishAt;
      if (probe && received < size && requestedDate && (!savedDate || Date.parse(savedDate) < Date.parse(requestedDate))) {
        await response.body?.cancel().catch(() => {});
        session = null;
        continue;
      }
      if (received <= offset && !probe) await pause(response);
      else await response.body?.cancel().catch(() => {});
      if (received > offset) retries = 0;
      offset = received;
      probe = offset === size;
      if (probe) await pause();
      continue;
    }
    if (response.status === 404) {
      await pause(response);
      session = null;
      continue;
    }
    if (!response.ok) throw await uploadFailure(response, 'el clip');
    const payload = await response.json().catch(() => null);
    if (payload?.id) return { ...payload, publishedMetadata: session.metadata, sessionPath };
    await pause();
    probe = true;
  }
}

export function uploadSingleClipWithSeo(jobId, clipFile, options) {
  return withPublicationQueue(() => uploadProjectClip(jobId, clipFile, options));
}

async function uploadProjectClip(jobId, clipFile, { infer, immediate = true, publishAtIso, forceSeo = false, signal, channelId: selectedChannel } = {}) {
  const job = await getJob(jobId);
  if (!job) throw new RequestError(404, `No existe el proyecto ${jobId}.`);
  const directory = jobDirectory(job);
  const clipIndex = (job.clips ?? []).findIndex((c) => c.file === clipFile);
  if (clipIndex === -1) throw new RequestError(404, `No existe el clip ${clipFile}.`);
  const clip = job.clips[clipIndex];
  const uploadLogPath = join(directory, 'youtube-uploads.json');
  const existingLog = await getJobUploads(directory);
  if (existingLog[clipFile]?.videoId) {
    return { file: clipFile, status: 'already_uploaded', ...existingLog[clipFile] };
  }
  const transcript = await readCheckpoint(directory, 'transcript.json');
  const seo = await analyzeAndSaveClipSeo(infer, directory, job.title, transcript, clip, clipIndex + 1, { force: forceSeo, signal, brand: await getBrand(job.brandId) });
  const draft = await readCheckpoint(directory, `${clipFile.slice(0, -4)}-youtube-draft.json`).catch(() => null);
  const effectivePublishAt = immediate ? undefined : (publishAtIso ?? new Date(Math.ceil((Date.now() + 15 * 60_000) / 3_600_000) * 3_600_000).toISOString());
  const metadata = buildVideoMetadata(clip, seo, effectivePublishAt, draft, job.title);
  const { accessToken, channelId, title: channelTitle } = await resolveUploadChannel(selectedChannel);
  const uploaded = await uploadSingleClip(accessToken, join(directory, clipFile), metadata, { channelId, signal });
  const actualPublishAt = uploaded.publishedMetadata.status.publishAt;
  const entry = {
    videoId: uploaded.id,
    url: clip.longForm ? `https://youtube.com/watch?v=${uploaded.id}` : `https://youtube.com/shorts/${uploaded.id}`,
    studioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
    channelId,
    channelTitle,
    title: uploaded.publishedMetadata.snippet.title,
    publishAt: actualPublishAt ?? 'public',
    privacyStatus: actualPublishAt ? 'scheduled' : 'public',
    seoScore: seo?.seoScore ?? null,
    uploadedAt: new Date().toISOString(),
  };
  existingLog[clipFile] = entry;
  await writeUploadJson(uploadLogPath, existingLog);
  await rm(uploaded.sessionPath, { force: true }).catch(() => {});
  return { file: clipFile, status: 'uploaded', ...entry };
}

/**
 * Analyze each clip one-by-one (frames + spoken transcript) to produce pro SEO,
 * then append the scheduled clips to the connected channel's queue.
 */
export function publishAllClipsBatch(jobId, options) {
  return withPublicationQueue(() => runPublicationBatch(jobId, options));
}

async function runPublicationBatch(jobId, {
  infer,
  intervalHours = 1,
  publishFirstImmediately = true,
  regenerateSeo = true,
  startAtIso,
  secretPath = clientSecretPath,
  loginHint,
  maxClips,
  signal,
  onProgress,
  channelId: selectedChannel,
} = {}) {
  const job = await getJob(jobId);
  if (!job) throw new RequestError(404, `No existe el proyecto ${jobId}.`);
  const directory = jobDirectory(job);
  const transcript = await readCheckpoint(directory, 'transcript.json');
  const uploadLogPath = join(directory, 'youtube-uploads.json');
  const existingLog = await getJobUploads(directory);
  const clips = (job.clips ?? []).slice(0, maxClips ?? (job.clips?.length ?? 0));
  const scheduled = (idx) => intervalHours > 0 && !(idx === 0 && publishFirstImmediately);
  const hasScheduledClips = clips.some((clip, idx) => scheduled(idx) && !existingLog[clip.file]?.videoId);
  signal?.throwIfAborted();
  const { accessToken, channelId, title: channelTitle, uploadsPlaylistId } = await resolveUploadChannel(selectedChannel, {
    includeUploads: hasScheduledClips, secretPath, loginHint,
  });
  let latest = null;
  if (hasScheduledClips) {
    onProgress?.({ phase: 'checking_schedule', message: 'Consultando la última publicación programada del canal…' });
    latest = await getLatestScheduledUpload(accessToken, uploadsPlaylistId, { signal });
  }
  const results = [];
  const brand = await getBrand(job.brandId);

  for (const [idx, clip] of clips.entries()) {
    if (signal?.aborted) throw new RequestError(499, 'Publicación cancelada.', 'CANCELLED');
    if (existingLog[clip.file]?.videoId) {
      results.push({ file: clip.file, status: 'already_uploaded', ...existingLog[clip.file] });
      onProgress?.({ phase: 'skipped', index: idx + 1, total: clips.length, file: clip.file, entry: existingLog[clip.file] });
      continue;
    }

    onProgress?.({ phase: 'seo', index: idx + 1, total: clips.length, file: clip.file, message: `Analizando clip ${idx + 1}/${clips.length} y creando SEO pro…` });
    const seo = await analyzeAndSaveClipSeo(infer, directory, job.title, transcript, clip, idx + 1, { force: regenerateSeo, signal, brand });
    const draft = await readCheckpoint(directory, `${clip.file.slice(0, -4)}-youtube-draft.json`).catch(() => null);

    const publishAtIso = scheduled(idx) ? nextPublishDate({ intervalHours, latest, startAtIso }) : undefined;
    const metadata = buildVideoMetadata(clip, seo, publishAtIso, draft, job.title);

    onProgress?.({
      phase: 'uploading',
      index: idx + 1,
      total: clips.length,
      file: clip.file,
      seoTitle: metadata.snippet.title,
      publishAt: publishAtIso ?? 'public',
      message: `Subiendo clip ${idx + 1}/${clips.length} a YouTube…`,
    });

    try {
      const uploaded = await uploadSingleClip(accessToken, join(directory, clip.file), metadata, { channelId, signal });
      const actualPublishAt = uploaded.publishedMetadata.status.publishAt;
      if (actualPublishAt) latest = Math.max(latest ?? 0, Date.parse(actualPublishAt));
      const entry = {
        videoId: uploaded.id,
        url: clip.longForm ? `https://youtube.com/watch?v=${uploaded.id}` : `https://youtube.com/shorts/${uploaded.id}`,
        studioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
        channelId,
        channelTitle,
        title: uploaded.publishedMetadata.snippet.title,
        publishAt: actualPublishAt ?? 'public',
        privacyStatus: actualPublishAt ? 'scheduled' : 'public',
        seoScore: seo?.seoScore ?? null,
        uploadedAt: new Date().toISOString(),
      };
      existingLog[clip.file] = entry;
      await writeUploadJson(uploadLogPath, existingLog);
      await rm(uploaded.sessionPath, { force: true }).catch(() => {});
      results.push({ file: clip.file, status: 'uploaded', ...entry });
      onProgress?.({ phase: 'uploaded', index: idx + 1, total: clips.length, file: clip.file, entry });
      console.error(`UPLOADED ${clip.file} -> ${entry.url} (publishAt: ${entry.publishAt})`);
    } catch (uploadErr) {
      results.push({ file: clip.file, status: 'error', message: uploadErr.message, publishAt: publishAtIso ?? 'public' });
      onProgress?.({ phase: 'error', index: idx + 1, total: clips.length, file: clip.file, message: uploadErr.message });
      return {
        jobId,
        uploadedCount: results.filter((r) => r.status === 'uploaded').length,
        totalTracked: Object.keys(existingLog).length,
        stoppedAt: clip.file,
        stopError: uploadErr.message,
        stopCode: uploadErr.code,
        results,
      };
    }
  }
  return {
    jobId,
    uploadedCount: results.filter((r) => r.status === 'uploaded').length,
    totalTracked: Object.keys(existingLog).length,
    results,
  };
}

/**
 * Upload and schedule all rendered clips of a Corte Studio project with 1-hour
 * (or custom) spacing via the official YouTube Data API v3, skipping clips already uploaded.
 */
export async function uploadProjectToYouTube(jobId, { startAtIso, intervalHours = 1, secretPath = clientSecretPath, loginHint, maxClips } = {}) {
  return publishAllClipsBatch(jobId, {
    startAtIso,
    intervalHours,
    secretPath,
    loginHint,
    maxClips,
    regenerateSeo: false,
    publishFirstImmediately: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--import-channel') {
  try {
    if (!process.argv[3]) throw new Error('Indica la carpeta que contiene la autorización anterior.');
    const credentials = join(process.argv[3], 'youtube-client-secret.json');
    const savedPath = join(process.argv[3], 'youtube-token.json');
    const token = await getAccessToken(credentials, undefined, { savedPath, interactive: false });
    const channel = await describeChannel(token);
    const stored = JSON.parse(await readFile(savedPath, 'utf8'));
    if (stored.channelId && stored.channelId !== channel.channelId) throw new Error('El canal verificado no coincide con la autorización guardada.');
    console.log(JSON.stringify(await storeChannel(channel, credentials, stored)));
  } catch (error) {
    console.error(error.status ? error.message : 'No se pudo importar la autorización anterior.');
    process.exitCode = 1;
  }
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--connect') {
  try {
    console.log(JSON.stringify(await verifyNewConnection(process.argv[3] || clientSecretPath)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Uso: node pipeline/youtube_upload.mjs <jobId> [intervalHours] [startAtIso] [loginHint]');
    process.exit(1);
  }
  const intervalHours = Number(process.argv[3] ?? 1);
  const startAtIso = process.argv[4];
  const loginHint = process.argv[5];
  uploadProjectToYouTube(jobId, { intervalHours, startAtIso, loginHint })
    .then((res) => console.log(JSON.stringify(res, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
