#!/usr/bin/env node
// Panel móvil de clips para compartir un enlace temporal. NO expone el estudio: solo sirve los MP4, las portadas y una
// página estática, bajo una ruta con un código aleatorio, y se apaga solo.
//
//   node scripts/clip-panel.mjs build <proyecto|prefijo> [--count 6]      re-renderiza los mejores clips y crea el panel
//   node scripts/clip-panel.mjs serve <carpeta> [--ttl 90] [--no-tunnel] [--tunnel ngrok|cloudflared]
//                                                                          lo sirve y abre un túnel temporal (ngrok por defecto)
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { delimiter, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getBrand } from '../pipeline/brands.mjs';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { analyzeAudioSignals, auditClip, getMediaTools, probeVideo, renderClip } from '../pipeline/media.mjs';

const run = promisify(execFile);
const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));
const panelsDir = join(dataDir, 'panels');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Frase corta por cada efecto que de verdad se aplicó al clip. */
export function describeEffects(fx = {}, audit = null) {
  const items = [];
  if (fx.coldOpen) items.push('Adelanto del pico al inicio');
  if (fx.cutSeconds >= 0.35) items.push(`Sin pausas: -${fx.cutSeconds.toFixed(1)} s`);
  if (fx.punches) items.push(`${fx.punches} empuje${fx.punches > 1 ? 's' : ''} de zoom con temblor`);
  if (fx.phraseZooms) items.push('Zoom alterno por frase');
  if (fx.bleeps) items.push(`${fx.bleeps} palabrota${fx.bleeps > 1 ? 's' : ''} censurada${fx.bleeps > 1 ? 's' : ''}`);
  if (fx.sfx?.length) items.push(`Efectos: ${[...new Set(fx.sfx)].join(', ')}`);
  if (fx.music) items.push('Música con ducking');
  if (audit) items.push(audit.ok ? `Auditoría OK · ${audit.lufs?.toFixed(1)} LUFS` : `Auditoría: ${audit.issues.join('; ')}`);
  return items;
}

export function panelPage({ title, source, clips, generatedAt }) {
  const cards = clips.map((clip, index) => `
    <article class="clip" id="c${index + 1}">
      <div class="stage" data-index="${index}">
        <video preload="none" playsinline webkit-playsinline poster="clips/${escapeHtml(clip.poster)}" src="clips/${escapeHtml(clip.file)}" controls controlslist="nodownload"></video>
        <button class="play" type="button" aria-label="Reproducir ${escapeHtml(clip.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
        <span class="num">${String(index + 1).padStart(2, '0')}</span>
        <span class="dur">${clock(clip.duration)}</span>
      </div>
      <div class="body">
        <h2>${escapeHtml(clip.title)}</h2>
        ${clip.hook ? `<p class="hook">${escapeHtml(clip.hook)}</p>` : ''}
        <div class="meta">${clip.category ? `<span class="chip">${escapeHtml(clip.category)}</span>` : ''}${clip.score ? `<span class="chip score">★ ${clip.score.toFixed(1)}</span>` : ''}<span class="chip">${clock(clip.start)}–${clock(clip.end)} del original</span></div>
        ${clip.effects.length ? `<details><summary>Qué se aplicó (${clip.effects.length})</summary><ul>${clip.effects.map((effect) => `<li>${escapeHtml(effect)}</li>`).join('')}</ul></details>` : ''}
        <a class="save" href="clips/${escapeHtml(clip.file)}" download="${escapeHtml(clip.downloadName)}">Descargar MP4</a>
      </div>
    </article>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07060d">
<meta name="robots" content="noindex, nofollow">
<title>Clips de prueba · Corte Studio</title>
<style>
:root{color-scheme:dark;--bg:#07060d;--card:#12101d;--line:#2a2342;--ink:#f6f4ff;--muted:#a79fc6;--accent:#8666ff;--cyan:#25e6ff;--amber:#ffbe3d}
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%}
body{font:16px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:radial-gradient(900px 420px at 10% -5%,#311d7a55,transparent 60%),var(--bg);color:var(--ink);padding:0 0 max(28px,env(safe-area-inset-bottom))}
header{padding:max(22px,env(safe-area-inset-top)) 18px 14px}
.eyebrow{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan)}
h1{font-size:25px;line-height:1.15;margin:6px 0 8px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:14px}
.sub b{color:var(--ink);font-weight:600}
main{display:grid;gap:18px;padding:6px 14px 0;max-width:560px;margin:0 auto}
.clip{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 14px 34px #0008}
.stage{position:relative;background:#000;aspect-ratio:9/16;max-height:78svh;margin:0 auto}
.stage video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.play{position:absolute;inset:0;margin:auto;width:76px;height:76px;border-radius:50%;border:0;background:#ffffffee;color:#111;display:grid;place-items:center;box-shadow:0 8px 28px #000a;cursor:pointer;-webkit-tap-highlight-color:transparent}
.play svg{width:34px;height:34px;fill:currentColor;margin-left:4px}
.stage.playing .play{display:none}
.num,.dur{position:absolute;top:12px;padding:4px 10px;border-radius:999px;font:600 13px/1.3 ui-monospace,Consolas,monospace;background:#000a;backdrop-filter:blur(6px);pointer-events:none}
.num{left:12px}.dur{right:12px}
.body{padding:14px 16px 16px}
h2{font-size:18px;line-height:1.25;margin-bottom:4px}
.hook{color:var(--amber);font-weight:600;font-size:15px;margin-bottom:10px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.chip{font-size:12.5px;padding:4px 10px;border-radius:999px;background:#ffffff0f;border:1px solid var(--line);color:var(--muted)}
.chip.score{color:var(--amber);border-color:#ffbe3d55}
details{margin-bottom:14px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:#0d0b16}
summary{padding:12px 0;font-size:14.5px;font-weight:600;cursor:pointer;min-height:44px;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';float:right;color:var(--cyan);font-weight:700}
details[open] summary::after{content:'–'}
ul{padding:0 0 12px 18px;color:var(--muted);font-size:14px}li{margin:3px 0}
.save{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:14px;background:linear-gradient(135deg,#8666ff,#5736e3);color:#fff;font-weight:700;text-decoration:none;-webkit-tap-highlight-color:transparent}
.save:active{transform:scale(.98)}
footer{padding:22px 18px 6px;text-align:center;color:var(--muted);font-size:12.5px}
@media (min-width:700px){main{grid-template-columns:repeat(2,1fr);max-width:1000px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
</head>
<body>
<header>
  <span class="eyebrow">Corte Studio · prueba</span>
  <h1>${clips.length} clips de GTA 6</h1>
  <p class="sub">Del vídeo <b>${escapeHtml(source)}</b>. Toca un clip para verlo con sonido.</p>
</header>
<main>${cards}</main>
<footer>Enlace temporal · generado ${escapeHtml(generatedAt)}</footer>
<script>
const stages=[...document.querySelectorAll('.stage')];
for(const stage of stages){
  const video=stage.querySelector('video');
  const play=stage.querySelector('.play');
  video.controls=false;
  const start=()=>{for(const other of stages){if(other!==stage){other.querySelector('video').pause()}}video.controls=true;video.play().catch(()=>{video.controls=true})};
  play.addEventListener('click',start);
  video.addEventListener('play',()=>{stage.classList.add('playing');video.controls=true});
  video.addEventListener('pause',()=>{if(video.ended||video.currentTime===0)stage.classList.remove('playing')});
  video.addEventListener('ended',()=>stage.classList.remove('playing'));
}
</script>
</body>
</html>`;
}

async function build(jobRef, count) {
  const entries = await readdir(join(dataDir, 'jobs'));
  const id = entries.find((name) => name.startsWith(jobRef));
  if (!id) throw new Error(`No hay ningún proyecto que empiece por ${jobRef}.`);
  const jobDir = join(dataDir, 'jobs', id);
  const job = JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8'));
  const sourceName = (await readdir(jobDir)).find((name) => /^source\./.test(name));
  if (!sourceName) throw new Error('Ese proyecto ya no tiene el vídeo fuente.');
  const source = join(jobDir, sourceName);
  const transcript = JSON.parse(await readFile(join(jobDir, 'transcript.json'), 'utf8'));
  const media = await probeVideo(source);
  const enriched = await analyzeAudioSignals(source, transcript);
  const brand = await getBrand(job.brandId);
  const format = normalizeFormat(job.format);
  const token = randomBytes(12).toString('hex');
  const root = join(panelsDir, token);
  const clipsDir = join(root, 'clips');
  await mkdir(clipsDir, { recursive: true });
  const { ffmpeg } = await getMediaTools();
  const chosen = [...job.clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, count).sort((a, b) => a.start - b.start);
  const clips = [];
  for (const [index, entry] of chosen.entries()) {
    const number = index + 1;
    const inside = enriched.segments.filter((segment) => segment.start >= entry.start + 3 && segment.end <= entry.end);
    const peak = [...inside].sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))[0];
    const clip = { ...entry, file: `clip-${number}.mp4`, ...(peak && peak.energy >= 8 ? { hasColdOpenHook: true, peakSegmentId: peak.id } : {}) };
    const report = {};
    const started = Date.now();
    await renderClip(source, clipsDir, clip, enriched, entry.framing, number, format, { aspect: media.aspect, brand, audioSegments: enriched.segments, report });
    const audit = await auditClip(join(clipsDir, clip.file), { assPath: join(clipsDir, `clip-${number}.ass`), format });
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', report.coldOpen ? '2.6' : '1.2', '-i', join(clipsDir, clip.file), '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', join(clipsDir, `clip-${number}.jpg`)], { windowsHide: true });
    clips.push({
      file: clip.file, poster: `clip-${number}.jpg`, title: String(entry.title ?? `Clip ${number}`).replace(/�/g, ''), hook: entry.onScreenHook, category: entry.category, score: entry.score,
      start: entry.start, end: entry.end, duration: report.duration ?? entry.end - entry.start,
      downloadName: `clip-gta6-${number}.mp4`, effects: describeEffects(report, audit), report, audit,
    });
    console.log(`clip ${number}/${chosen.length} listo en ${((Date.now() - started) / 1000).toFixed(1)} s · ${describeEffects(report, audit).join(' | ')}`);
  }
  const page = panelPage({ title: job.title, source: String(job.title).replace(/�/g, ''), clips, generatedAt: new Date().toLocaleString('es-ES') });
  await writeFile(join(root, 'index.html'), page, 'utf8');
  await writeFile(join(root, 'panel.json'), JSON.stringify({ token, job: id, clips }, null, 2), 'utf8');
  console.log(`PANEL ${root}`);
}

const types = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };

async function serveFile(request, response, path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return response.end('No encontrado'); }
  const headers = { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  let start = 0;
  let end = info.size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else if (range[2]) start = Math.max(0, info.size - Number(range[2]));
    if (!Number.isSafeInteger(start) || start > end || start >= info.size) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); return response.end(); }
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

async function findBinary(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory.replace(/^"|"$/g, ''), process.platform === 'win32' ? `${name}.exe` : name);
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  return null;
}

/** Abre el túnel con el proveedor elegido y avisa de la URL pública por `onUrl`. Devuelve el proceso hijo. */
async function openTunnel(provider, port, prefix, onUrl) {
  const binary = await findBinary(provider);
  if (!binary) throw new Error(`${provider} no está en el PATH`);
  const args = provider === 'ngrok'
    ? ['http', `127.0.0.1:${port}`, '--log', 'stdout', '--log-format', 'json']
    : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;
  const inspect = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      const url = provider === 'ngrok'
        ? (() => { try { const entry = JSON.parse(line); return /started tunnel/i.test(entry.msg ?? '') ? entry.url : null; } catch { return null; } })()
        : /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0];
      if (url?.startsWith('https://') && !announced) { announced = true; onUrl(`${url}${prefix}`); }
      if (/ERR_NGROK|failed to (?:start|request)|error="/i.test(line) && !announced) console.log(`ERROR ${line.trim().slice(0, 300)}`);
    }
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  child.on('exit', (code) => { if (!announced) console.log(`ERROR ${provider} terminó con código ${code}`); });
  return child;
}

async function serve(directory, ttlMinutes, tunnel) {  // tunnel: 'ngrok' | 'cloudflared' | null
  const root = resolve(directory);
  const { token } = JSON.parse(await readFile(join(root, 'panel.json'), 'utf8'));
  const prefix = `/${token}/`;
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
      const pathname = decodeURIComponent(new URL(request.url, 'http://panel.local').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return response.end('No encontrado'); }
      const relative = pathname.slice(prefix.length) || 'index.html';
      const target = resolve(root, relative);
      const allowed = relative === 'index.html' || (/^clips\/clip-\d+\.(?:mp4|jpg)$/.test(relative) && target.startsWith(join(root, 'clips') + sep));
      if (!allowed) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return response.end('No encontrado'); }
      await serveFile(request, response, target);
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  console.log(`LOCAL http://127.0.0.1:${port}${prefix}`);
  let ngrok = null;
  const stop = (reason) => {
    console.log(`FIN ${reason}`);
    ngrok?.kill();
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  };
  if (tunnel) {
    try {
      ngrok = await openTunnel(tunnel, port, prefix, (url) => console.log(`URL ${url}`));
    } catch (error) {
      console.log(`ERROR ${error.message}`);
      return stop('sin túnel');
    }
  }
  setTimeout(() => stop(`caducó a los ${ttlMinutes} min`), ttlMinutes * 60_000).unref?.();
  process.on('SIGINT', () => stop('interrumpido'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, target, ...rest] = process.argv.slice(2);
  const option = (name, fallback) => (rest.includes(`--${name}`) ? Number(rest[rest.indexOf(`--${name}`) + 1]) : fallback);
  if (command === 'build' && target) await build(target, option('count', 6));
  else if (command === 'serve' && target) {
    const provider = rest.includes('--tunnel') ? rest[rest.indexOf('--tunnel') + 1] : 'ngrok';
    await serve(target, option('ttl', 90), rest.includes('--no-tunnel') ? null : provider);
  }
  else console.log('Uso: clip-panel.mjs build <proyecto> [--count 6] | serve <carpeta> [--ttl 90] [--no-tunnel]');
}
