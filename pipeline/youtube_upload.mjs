import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RequestError } from './errors.mjs';
import { getJob, jobDirectory, readCheckpoint } from './jobs.mjs';
import { dataDir } from './media.mjs';
import { analyzeAndSaveClipSeo, inferGameContext } from './publication.mjs';

export const clientSecretPath = join(dataDir, 'youtube-client-secret.json');
export const tokenPath = join(dataDir, 'youtube-token.json');
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

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
    execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
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

async function authorizeInteractive(creds, loginHint) {
  const target = pickLocalRedirect(creds);
  let server;
  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server?.close();
      reject(new RequestError(408, 'Tiempo de espera agotado esperando autorización OAuth en el navegador.'));
    }, 5 * 60_000);

    let boundUri = target.exactUri;
    server = createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://${target.hostname}:${target.port || 80}`);
      if (target.pathname !== '/' && reqUrl.pathname !== target.pathname) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const authCode = reqUrl.searchParams.get('code');
      const authError = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authCode
        ? '<h2>Autorización de Corte Studio completada. Ya puedes cerrar esta pestaña.</h2>'
        : `<h2>Autorización cancelada (${authError || 'error'}).</h2>`);
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
      authUrl.searchParams.set('prompt', 'consent');
      if (loginHint) authUrl.searchParams.set('login_hint', loginHint);
      console.error(`CORTE_AUTH_URL:${authUrl.toString()}`);
      openBrowserUrl(authUrl.toString());
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
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    throw new RequestError(401, `No se pudo intercambiar el código OAuth: ${tokens.error_description || tokens.error || tokenRes.status}`);
  }
  const saved = { ...tokens, obtainedAt: Date.now() };
  await mkdir(dataDir, { recursive: true });
  await writeFile(tokenPath, JSON.stringify(saved, null, 2), 'utf8');
  return saved;
}

async function getAccessToken(customSecretPath = clientSecretPath, loginHint) {
  const creds = await loadClientCredentials(customSecretPath);
  const existing = await readFile(tokenPath, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
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
      await writeFile(tokenPath, JSON.stringify(merged, null, 2), 'utf8');
      return merged.access_token;
    }
  }
  const fresh = await authorizeInteractive(creds, loginHint);
  return fresh.access_token;
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
  let creds;
  try {
    creds = await loadClientCredentials(customSecretPath);
  } catch (err) {
    return { connected: false, hasCredentials: false, reason: err.message };
  }
  const existing = await readFile(tokenPath, 'utf8').then((s) => JSON.parse(s)).catch(() => null);
  if (!existing?.refresh_token && !existing?.access_token) {
    return { connected: false, hasCredentials: true, reason: 'Falta autorizar el canal de YouTube.' };
  }
  try {
    let token = existing.access_token;
    const validUntil = existing?.expiry_date ?? (existing?.obtainedAt ? existing.obtainedAt + (existing.expires_in || 3500) * 1000 : 0);
    if (!token || (validUntil - 60_000) <= Date.now()) {
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
      if (!res.ok || !refreshed.access_token) {
        return { connected: false, hasCredentials: true, reason: 'La sesión OAuth de YouTube ha caducado.' };
      }
      token = refreshed.access_token;
      await writeFile(tokenPath, JSON.stringify({ ...existing, ...refreshed, obtainedAt: Date.now() }, null, 2), 'utf8');
    }
    const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const item = ch.items?.[0];
    if (!item?.id) return { connected: false, hasCredentials: true, reason: 'No se encontró canal asociado.' };
    return {
      connected: true,
      hasCredentials: true,
      channelId: item.id,
      title: item.snippet?.title || 'YouTube',
      handle: item.snippet?.customUrl || '',
    };
  } catch (err) {
    return { connected: false, hasCredentials: true, reason: err.message };
  }
}

/**
 * Format YouTube snippet + scheduled status from Corte Studio publication SEO JSON.
 */
export function buildVideoMetadata(clip, seo, publishAtIso, draft, sourceTitle = '') {
  const yt = seo?.platforms?.youtube ?? {};
  const gameCtx = inferGameContext(sourceTitle, clip, yt.text || seo?.hook || '', seo?.game || '');
  const rawTitle = draft?.title || yt.title || `${clip.title} #Shorts`;
  const title = /#shorts/i.test(rawTitle) ? rawTitle.slice(0, 100) : `${rawTitle.slice(0, 91).trim()} #Shorts`;
  const draftTags = Array.isArray(draft?.hashtags) ? draft.hashtags.map((h) => String(h).replace(/^#/, '')) : [];
  const gameTags = (gameCtx?.hashtags ?? []).map((h) => h.replace(/^#/, ''));
  const ytTags = Array.isArray(yt.hashtags) ? yt.hashtags.map((h) => h.replace(/^#/, '')) : [];
  const orderedHashNames = [];
  const seenHash = new Set();
  for (const tag of [...gameTags, ...(draftTags.length ? draftTags : ytTags), 'Shorts']) {
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

async function uploadSingleClip(accessToken, filePath, metadata) {
  const { size } = await stat(filePath);
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new RequestError(initRes.status, `YouTube API rechazó el inicio de subida: ${errText.slice(0, 300)}`);
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new RequestError(502, 'YouTube API no devolvió cabecera Location para la subida resumible.');

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    duplex: 'half',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
    },
    body: createReadStream(filePath),
  });
  const payload = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !payload.id) {
    throw new RequestError(putRes.status, `Error al subir vídeo a YouTube API: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

export async function uploadSingleClipWithSeo(jobId, clipFile, { infer, immediate = true, publishAtIso, forceSeo = false, signal } = {}) {
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
  const seo = await analyzeAndSaveClipSeo(infer, directory, job.title, transcript, clip, clipIndex + 1, { force: forceSeo, signal });
  const draft = await readCheckpoint(directory, `${clipFile.slice(0, -4)}-youtube-draft.json`).catch(() => null);
  const effectivePublishAt = immediate ? undefined : (publishAtIso ?? new Date(Math.ceil((Date.now() + 15 * 60_000) / 3_600_000) * 3_600_000).toISOString());
  const metadata = buildVideoMetadata(clip, seo, effectivePublishAt, draft, job.title);
  const accessToken = await getAccessToken();
  const uploaded = await uploadSingleClip(accessToken, join(directory, clipFile), metadata);
  const entry = {
    videoId: uploaded.id,
    url: `https://youtube.com/shorts/${uploaded.id}`,
    studioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
    title: metadata.snippet.title,
    publishAt: effectivePublishAt ?? 'public',
    privacyStatus: effectivePublishAt ? 'scheduled' : 'public',
    seoScore: seo?.seoScore ?? null,
    uploadedAt: new Date().toISOString(),
  };
  existingLog[clipFile] = entry;
  await writeFile(uploadLogPath, JSON.stringify(existingLog, null, 2), 'utf8');
  return { file: clipFile, status: 'uploaded', ...entry };
}

/**
 * Analyze each clip one-by-one (frames + spoken transcript) to produce pro SEO,
 * then upload and schedule them 1 hour apart (with optional immediate 1st clip).
 */
export async function publishAllClipsBatch(jobId, {
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
} = {}) {
  const job = await getJob(jobId);
  if (!job) throw new RequestError(404, `No existe el proyecto ${jobId}.`);
  const directory = jobDirectory(job);
  const transcript = await readCheckpoint(directory, 'transcript.json');
  const uploadLogPath = join(directory, 'youtube-uploads.json');
  const existingLog = await getJobUploads(directory);
  const accessToken = await getAccessToken(secretPath, loginHint);
  const clips = (job.clips ?? []).slice(0, maxClips ?? (job.clips?.length ?? 0));
  const baseDate = startAtIso
    ? new Date(startAtIso)
    : new Date(Math.ceil((Date.now() + 15 * 60_000) / 3_600_000) * 3_600_000);
  const results = [];

  for (const [idx, clip] of clips.entries()) {
    if (signal?.aborted) throw new RequestError(499, 'Publicación cancelada.', 'CANCELLED');
    if (existingLog[clip.file]?.videoId) {
      results.push({ file: clip.file, status: 'already_uploaded', ...existingLog[clip.file] });
      onProgress?.({ phase: 'skipped', index: idx + 1, total: clips.length, file: clip.file, entry: existingLog[clip.file] });
      continue;
    }

    onProgress?.({ phase: 'seo', index: idx + 1, total: clips.length, file: clip.file, message: `Analizando clip ${idx + 1}/${clips.length} y creando SEO pro…` });
    const seo = await analyzeAndSaveClipSeo(infer, directory, job.title, transcript, clip, idx + 1, { force: regenerateSeo, signal });
    const draft = await readCheckpoint(directory, `${clip.file.slice(0, -4)}-youtube-draft.json`).catch(() => null);

    let publishAtIso;
    if (intervalHours > 0) {
      const slotOffset = publishFirstImmediately ? Math.max(0, idx - 1) : idx;
      if (!(idx === 0 && publishFirstImmediately)) {
        publishAtIso = new Date(baseDate.getTime() + slotOffset * intervalHours * 3_600_000).toISOString();
      }
    }
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
      const uploaded = await uploadSingleClip(accessToken, join(directory, clip.file), metadata);
      const entry = {
        videoId: uploaded.id,
        url: `https://youtube.com/shorts/${uploaded.id}`,
        studioUrl: `https://studio.youtube.com/video/${uploaded.id}/edit`,
        title: metadata.snippet.title,
        publishAt: publishAtIso ?? 'public',
        privacyStatus: publishAtIso ? 'scheduled' : 'public',
        seoScore: seo?.seoScore ?? null,
        uploadedAt: new Date().toISOString(),
      };
      existingLog[clip.file] = entry;
      await writeFile(uploadLogPath, JSON.stringify(existingLog, null, 2), 'utf8');
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
