import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import demo from './dist/demo.js';
import youtube from './dist/youtube.js';
import { loadGeminiKey, loadOpenRouterKey } from './pipeline/credentials.mjs';
import { RequestError } from './pipeline/errors.mjs';
import { geminiJson, parseModelJson } from './pipeline/gemini.mjs';
import { cancelAllJobs, getClipFile, getJob, getSourceFile, getTranscript, jobDirectory, listJobs, openJobInference, resumeJob, startJob, subscribeJobEvents } from './pipeline/jobs.mjs';
import { listLlamaModels } from './pipeline/llama.mjs';
import { listVoiceModels } from './pipeline/media.mjs';
import { defaultOpenRouterModel, openRouterModels } from './pipeline/openrouter.mjs';
import { loadPublication, savePublicationDraft } from './pipeline/publication.mjs';
import { exportAllProjects, exportRoot } from './pipeline/export.mjs';
import { handleBrandsRoute } from './routes/brands-routes.mjs';
import { handleSystemRoute } from './routes/system-routes.mjs';
import { handleQueueRoute } from './routes/queue-routes.mjs';
import { handleNleRoute } from './routes/nle-routes.mjs';
import { popNextQueuedJob } from './pipeline/queue.mjs';
import { normalizeFormat } from './pipeline/formats.mjs';
import { connectYouTubeChannel, getJobUploads, getYouTubeChannelConnection, getYouTubeConnectionStatus, publishAllClipsBatch, uploadSingleClipWithSeo } from './pipeline/youtube_upload.mjs';

const host = '127.0.0.1';
const port = 4173;
const origin = `http://${host}:${port}`;
const ollama = 'http://127.0.0.1:11434';
const lmPort = Number(process.env.CORTE_LM_STUDIO_PORT ?? 1234);
if (!Number.isInteger(lmPort) || lmPort < 1 || lmPort > 65535 || lmPort === port || lmPort === 11434) {
  throw new Error('CORTE_LM_STUDIO_PORT debe ser un puerto válido y distinto de 4173 y 11434.');
}
const lmStudio = `http://127.0.0.1:${lmPort}`;
const geminiKey = await loadGeminiKey().catch(() => {
  console.error('La credencial local de Corte Studio no está disponible para este usuario de Windows.');
  return null;
});
const openRouterKey = await loadOpenRouterKey().catch(() => {
  console.error('La credencial local de OpenRouter no está disponible para este usuario de Windows.');
  return null;
});
const modelIdPattern = /^[\w.@:/+\-]{1,180}$/;
const asset = '/assets/podcast.png';
const demoImage = new URL(`dist${asset}`, import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/studio.css', ['studio.css', 'text/css; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/youtube.js', ['youtube.js', 'text/javascript; charset=utf-8']],
  ['/studio.js', ['studio.js', 'text/javascript; charset=utf-8']],
  ['/jobs.js', ['jobs.js', 'text/javascript; charset=utf-8']],
  ['/publication.js', ['publication.js', 'text/javascript; charset=utf-8']],
  ['/pro-studio.js', ['pro-studio.js', 'text/javascript; charset=utf-8']],
  ['/pro-studio.css', ['pro-studio.css', 'text/css; charset=utf-8']],
  [asset, ['assets/podcast.png', 'image/png']],
]);

const visionSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    left: { type: 'number', minimum: 0, maximum: 1 },
    right: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['subject', 'left', 'right'],
  additionalProperties: false,
};
const cropInstruction = 'Identifica al sujeto principal que conviene mantener visible al recortar esta imagen a 9:16. Estima el borde izquierdo y el derecho de su cabeza o zona de interés en la imagen original, con 0 en el extremo izquierdo y 1 en el extremo derecho.';
const visionPrompt = `${cropInstruction} Devuelve únicamente un objeto JSON válido con las claves subject (descripción breve en español), left y right (números).`;
const geminiSchema = {
  type: 'object',
  properties: {
    ...visionSchema.properties,
    startSegmentId: { type: 'integer' },
    endSegmentId: { type: 'integer' },
    title: { type: 'string' },
  },
  required: [...visionSchema.required, 'startSegmentId', 'endSegmentId', 'title'],
  additionalProperties: false,
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function post(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function localJson(base, route, options = {}, timeout = 5_000) {
  const headers = { ...options.headers };
  if (base === lmStudio && process.env.CORTE_LM_STUDIO_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CORTE_LM_STUDIO_TOKEN}`;
  }

  let response;
  try {
    response = await fetch(base + route, { ...options, headers, signal: AbortSignal.timeout(timeout), redirect: 'error' });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    const name = base === ollama ? 'Ollama' : 'LM Studio';
    throw new RequestError(502, timedOut ? `${name} agotó el tiempo de espera.` : `No se pudo conectar con ${name} en ${base}.`);
  }
  if (!response.ok) throw new RequestError(502, `El proveedor local respondió con HTTP ${response.status}. Revisa su servidor, modelo y permisos.`);
  return response.json();
}

function isLocalOllama(model) {
  return typeof model.name === 'string' && !model.name.endsWith(':cloud') && !model.name.endsWith('-cloud') && !model.remote_host && !model.remote_model;
}

async function listModels(provider) {
  if (provider === 'ollama') {
    const result = await localJson(ollama, '/api/tags');
    return (result.models ?? []).filter(isLocalOllama).map(({ name }) => ({ id: name, label: name }));
  }

  const result = await localJson(lmStudio, '/api/v1/models');
  return (result.models ?? []).filter((model) => model.type === 'llm' && model.format === 'gguf' && model.capabilities?.vision)
    .flatMap((model) => (model.loaded_instances ?? []).map(({ id }) => ({
      id, label: model.display_name || id, reasoningOff: model.capabilities.reasoning?.allowed_options?.includes('off'),
    })));
}

function portraitCrop(image, { subject, left, right }) {
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || !Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right > 1 || left >= right) {
    throw new RequestError(502, 'El modelo no devolvió un encuadre válido.');
  }
  const aspect = image.readUInt32BE(16) / image.readUInt32BE(20);
  const visibleFraction = 9 / 16 / aspect;
  const center = (left + right) / 2;
  const crop = Math.round(100 * Math.max(0, Math.min(1, (center - visibleFraction / 2) / (1 - visibleFraction))));
  return { subject: subject.trim(), crop };
}

async function testVision(provider, model) {
  const models = await listModels(provider);
  const selected = models.find(({ id }) => id === model);
  if (!selected) throw new RequestError(400, 'Elige un modelo de la lista local. En LM Studio el modelo con visión debe estar cargado.');
  if (provider === 'ollama') {
    const info = await localJson(ollama, '/api/show', post({ model }));
    if (info.remote_host || info.remote_model || !info.capabilities?.includes('vision')) {
      throw new RequestError(400, 'El modelo seleccionado debe estar instalado en el PC y admitir imágenes.');
    }
  }

  const image = await readFile(demoImage);
  const encoded = image.toString('base64');
  let content;
  if (provider === 'ollama') {
    const output = await localJson(ollama, '/api/chat', post({
      model, stream: false, think: false, format: visionSchema,
      options: { temperature: 0, num_ctx: 4096, num_predict: 256 },
      messages: [{ role: 'user', content: visionPrompt, images: [encoded] }],
    }), 120_000);
    content = output.message?.content;
  } else {
    const output = await localJson(lmStudio, '/api/v1/chat', post({
      model, stream: false, store: false, temperature: 0, max_output_tokens: 384,
      ...(selected.reasoningOff ? { reasoning: 'off' } : {}),
      input: [
        { type: 'text', content: visionPrompt },
        { type: 'image', data_url: `data:image/png;base64,${encoded}` },
      ],
    }), 120_000);
    content = output.output?.find(({ type }) => type === 'message')?.content;
  }

  return portraitCrop(image, parseModelJson(content));
}

function getGeminiKey() {
  if (!geminiKey) throw new RequestError(503, 'El motor Gemini no está disponible en esta instalación.');
  return geminiKey;
}

function getOpenRouterKey() {
  if (!openRouterKey) throw new RequestError(503, 'El motor OpenRouter no está configurado en esta instalación.');
  return openRouterKey;
}

async function analyzeWithGemini() {
  const key = getGeminiKey();

  const image = await readFile(demoImage);
  const segments = demo.transcript.map((segment, index) => ({ id: index + 1, ...segment }));
  const prompt = `${cropInstruction} Expresa el resultado en subject (descripción breve en español), left y right. Además, elige un único corte de 20 a 40 segundos a partir de la transcripción de ejemplo. Busca un gancho inicial y una idea que se entienda por sí sola. Devuelve el título en español y los IDs del primer y último segmento en startSegmentId y endSegmentId. El tiempo de inicio y fin se toma de esos segmentos.\n\n${JSON.stringify(segments)}`;
  const proposal = await geminiJson(key, {
    schema: geminiSchema, maxOutputTokens: 1024,
    parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: image.toString('base64') } }],
  });
  const { startSegmentId, endSegmentId, title } = proposal;
  const start = Number.isInteger(startSegmentId) ? segments[startSegmentId - 1]?.start : undefined;
  const end = Number.isInteger(endSegmentId) ? segments[endSegmentId - 1]?.end : undefined;
  const duration = end - start;
  if (!Number.isFinite(duration) || duration < 20 || duration > 40 || typeof title !== 'string' || !title.trim() || title.length > 120) {
    throw new RequestError(502, 'Gemini no devolvió un rango de ejemplo entre 20 y 40 segundos.');
  }
  return { start, end, title: title.trim(), ...portraitCrop(image, proposal) };
}

async function readStudioRequest(request, limit = 1024) {
  if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
    throw new RequestError(403, 'La prueba solo está disponible desde la página local del estudio.');
  }
  let body = '';
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk;
    if (body.length > limit) throw new RequestError(413, 'La petición es demasiado grande.');
  }
  try { return JSON.parse(body) ?? {}; } catch { throw new RequestError(400, 'Se esperaba un objeto JSON.'); }
}

async function streamVideoFile(request, response, path, contentType = 'video/mp4') {
  const { size } = await stat(path);
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  let start = 0;
  let end = size - 1;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else if (match?.[2]) {
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = size;
    }
    if (!Number.isSafeInteger(start) || start >= size || end < start) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      response.end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

async function serveClip(request, response, id, name) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'Método no disponible.');
  const path = await getClipFile(id, name);
  if (!path) throw new RequestError(404, 'El clip no está disponible.');
  await streamVideoFile(request, response, path, 'video/mp4');
}

async function serveSource(request, response, id) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'Método no disponible.');
  const path = await getSourceFile(id);
  if (!path) throw new RequestError(404, 'El vídeo fuente aún no está disponible.');
  const contentType = /\.(mkv|webm)$/i.test(path) ? 'video/webm' : 'video/mp4';
  await streamVideoFile(request, response, path, contentType);
}

async function serveSubtitles(request, response, id, clipName) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'Método no disponible.');
  const clip = await getClipFile(id, `${clipName}.mp4`);
  if (!clip) throw new RequestError(404, 'El clip no está disponible.');
  const name = `${clipName}.ass`;
  const subtitles = await readFile(join(dirname(clip), name)).catch((error) => {
    if (error.code === 'ENOENT') throw new RequestError(404, 'Los subtítulos no están disponibles.');
    throw error;
  });
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Content-Length': subtitles.length,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : subtitles);
}

async function modelRequest(request, response) {
  const { action, provider, model } = await readStudioRequest(request);
  if (!['ollama', 'lmstudio'].includes(provider)) throw new RequestError(400, 'Elige Ollama o LM Studio.');
  if (action === 'list') {
    const models = await listModels(provider);
    return sendJson(response, 200, { models: models.map(({ id, label }) => ({ id, label })) });
  }
  if (action !== 'vision' || typeof model !== 'string' || !modelIdPattern.test(model)) throw new RequestError(400, 'Acción o ID de modelo no válido.');
  sendJson(response, 200, await testVision(provider, model));
}

async function resolveEngine(provider = 'gemini', modelId) {
  if (provider === 'gemini') return { provider, key: getGeminiKey() };
  if (provider === 'openrouter') {
    const modelInfo = openRouterModels.find(({ id }) => id === defaultOpenRouterModel) ?? { id: defaultOpenRouterModel, label: defaultOpenRouterModel };
    return { provider, key: getOpenRouterKey(), model: modelInfo };
  }
  if (provider === 'local') {
    const model = (await listLlamaModels()).find(({ id }) => id === modelId);
    if (!model) throw new RequestError(400, 'Elige un modelo GGUF local con visión que esté disponible.');
    return { provider, model };
  }
  throw new RequestError(400, 'Elige Gemini, OpenRouter o un modelo local.');
}

const activePublishBatches = new Map();
let drainingQueue = false;
async function drainQueue() {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    const next = await popNextQueuedJob();
    if (!next) return;
    const source = youtube.parseVideoSource(next.url);
    if (!source) return;
    const engine = await resolveOptionalEngine(next.provider, next.model);
    if (!engine) return;
    await startJob(source, engine, undefined, next.format ? normalizeFormat(next.format) : undefined, {
      mode: next.mode || 'normal',
      voice: next.voice,
      summaryOptions: next.summaryOptions,
      brandId: next.brandId,
    }).catch(() => {});
  } finally {
    drainingQueue = false;
  }
}

subscribeJobEvents((updated) => {
  if (['done', 'error'].includes(updated?.stage)) void drainQueue();
});


async function resolveOptionalEngine(provider, modelId) {
  try {
    if (provider) return await resolveEngine(provider, modelId);
  } catch { /* Fall back cleanly across configured providers */ }
  if (geminiKey) return { provider: 'gemini', key: geminiKey };
  if (openRouterKey) return { provider: 'openrouter', key: openRouterKey, model: { id: defaultOpenRouterModel, label: defaultOpenRouterModel } };
  const locals = await listLlamaModels().catch(() => []);
  if (locals[0]) return { provider: 'local', model: locals[0] };
  return null;
}

createServer(async (request, response) => {
  try {
    if (request.headers.host !== `${host}:${port}`) throw new RequestError(403, 'Usa la dirección local del estudio.');
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/api/local-model') return await modelRequest(request, response);
    if (pathname === '/api/gemini-demo') {
      await readStudioRequest(request);
      return sendJson(response, 200, await analyzeWithGemini());
    }
    if (pathname === '/api/engines' && request.method === 'GET') {
      const [models, voices] = await Promise.all([listLlamaModels(), listVoiceModels()]);
      const openrouterModel = openRouterModels.find(({ id }) => id === defaultOpenRouterModel)?.label ?? defaultOpenRouterModel;
      return sendJson(response, 200, { gemini: Boolean(geminiKey), openrouter: Boolean(openRouterKey), openrouterModel, models, voices, exportDir: exportRoot });
    }
    if (pathname === '/api/jobs' && request.method === 'POST') {
      const { url, retryJobId, provider = 'gemini', model: modelId, format, mode = 'normal', voice, targetMinutes, captions, brandId } = await readStudioRequest(request, 5000);
      const source = typeof url === 'string' && youtube.parseVideoSource(url.trim());
      if (!source) throw new RequestError(400, 'Introduce un enlace válido de YouTube o Twitch (vídeo, clip o directo).');
      const engine = await resolveEngine(provider, modelId);
      const cleanVoice = typeof voice === 'string' && /^(?:piper|edge):[\w.-]+$/i.test(voice.trim()) ? voice.trim() : 'piper:es_ES-davefx-medium';
      return sendJson(response, 202, await startJob(source, engine, retryJobId, normalizeFormat(format), { mode, voice: cleanVoice, summaryOptions: { targetMinutes, captions }, brandId: typeof brandId === 'string' ? brandId : undefined }));
    }
    const resumeMatch = /^\/api\/jobs\/([a-f0-9-]+)\/(resume|search-more)$/.exec(pathname);
    if (resumeMatch && request.method === 'POST') {
      const { provider, model: modelId } = await readStudioRequest(request, 5000);
      const existing = await getJob(resumeMatch[1]);
      if (!existing) throw new RequestError(404, 'Este análisis ya no está disponible.');
      const searchMore = resumeMatch[2] === 'search-more';
      const engine = searchMore && existing.provider === 'agent'
        ? await resolveOptionalEngine()
        : await resolveEngine(provider || existing.provider || 'openrouter', modelId ?? existing.modelId);
      if (!engine) throw new RequestError(400, 'Configura un motor de IA para buscar más clips.');
      return sendJson(response, 202, await resumeJob(resumeMatch[1], engine, { searchMore }));
    }
    const routeContext = { request, response, pathname, searchParams: new URL(request.url, origin).searchParams, origin, sendJson, resolveEngine, onQueueChanged: drainQueue };
    if (await handleBrandsRoute(routeContext) || await handleSystemRoute(routeContext) || await handleQueueRoute(routeContext) || await handleNleRoute(routeContext)) return;
    if (pathname === '/api/export' && request.method === 'POST') {
      await readStudioRequest(request, 1024);
      return sendJson(response, 200, await exportAllProjects());
    }
    if (pathname === '/api/jobs' && request.method === 'GET') {
      return sendJson(response, 200, { jobs: await listJobs() });
    }
    if (pathname === '/api/jobs/cancel' && request.method === 'POST') {
      await readStudioRequest(request);
      return sendJson(response, 200, await cancelAllJobs());
    }
    const eventsMatch = /^\/api\/jobs\/([a-f0-9-]+)\/events$/.exec(pathname);
    if (eventsMatch && request.method === 'GET') {
      const id = eventsMatch[1];
      const job = await getJob(id);
      if (!job) throw new RequestError(404, 'Este análisis ya no está disponible.');
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      const push = (payload) => {
        if (!response.destroyed) response.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      push(job);
      const unsubscribe = subscribeJobEvents((updated) => {
        if (updated.id === id) push({ ...updated, url: youtube.sourceFromJob(updated).url });
      });
      const keepAlive = setInterval(() => {
        if (!response.destroyed) response.write(': keepalive\n\n');
      }, 15000);
      request.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }
    const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(pathname);
    if (jobMatch && request.method === 'GET') {
      const job = await getJob(jobMatch[1]);
      if (!job) throw new RequestError(404, 'Este análisis ya no está disponible.');
      return sendJson(response, 200, job);
    }
    const transcriptMatch = /^\/api\/jobs\/([a-f0-9-]+)\/transcript$/.exec(pathname);
    if (transcriptMatch && request.method === 'GET') {
      const transcript = await getTranscript(transcriptMatch[1]);
      if (!transcript) throw new RequestError(404, 'La transcripción aún no está disponible.');
      return sendJson(response, 200, transcript);
    }
    if (pathname === '/api/youtube/status' && request.method === 'GET') {
      return sendJson(response, 200, await getYouTubeConnectionStatus());
    }
    if (pathname === '/api/youtube/connect' && request.method === 'GET') {
      return sendJson(response, 200, getYouTubeChannelConnection());
    }
    if (pathname === '/api/youtube/connect' && request.method === 'POST') {
      await readStudioRequest(request, 5000);
      return sendJson(response, 202, connectYouTubeChannel());
    }
    const uploadsMatch = /^\/api\/jobs\/([a-f0-9-]+)\/uploads$/.exec(pathname);
    if (uploadsMatch && request.method === 'GET') {
      const job = await getJob(uploadsMatch[1]);
      if (!job) throw new RequestError(404, 'Este proyecto no existe.');
      return sendJson(response, 200, {
        uploads: await getJobUploads(jobDirectory(job)),
        batch: activePublishBatches.get(job.id) ?? null,
      });
    }
    const publishAllMatch = /^\/api\/jobs\/([a-f0-9-]+)\/publish-all$/.exec(pathname);
    if (publishAllMatch && request.method === 'POST') {
      const id = publishAllMatch[1];
      const body = await readStudioRequest(request, 5000);
      const job = await getJob(id);
      if (!job || !job.clips?.length) throw new RequestError(400, 'Este proyecto no tiene clips exportados.');
      const existingBatch = activePublishBatches.get(id);
      if (existingBatch?.running) return sendJson(response, 409, { error: 'Ya se está ejecutando la publicación automática de este proyecto.', batch: existingBatch });
      const intervalHours = Number.isFinite(Number(body.intervalHours)) ? Math.max(0, Math.min(72, Number(body.intervalHours))) : 1;
      const publishFirstImmediately = body.publishFirstImmediately !== false;
      const regenerateSeo = body.regenerateSeo !== false;
      const state = {
        running: true,
        phase: 'starting',
        index: 0,
        total: job.clips.length,
        file: null,
        message: 'Conectando canal de YouTube y analizando clips 1 a 1…',
        error: null,
        results: [],
      };
      activePublishBatches.set(id, state);
      void (async () => {
        let engineCtx = null;
        try {
          const engine = await resolveOptionalEngine(body.provider || job.provider, body.model ?? job.modelId);
          engineCtx = await openJobInference(engine, jobDirectory(job));
          const summary = await publishAllClipsBatch(id, {
            infer: engineCtx.infer,
            channelId: body.channelId,
            intervalHours,
            publishFirstImmediately,
            regenerateSeo,
            onProgress: (ev) => {
              Object.assign(state, {
                phase: ev.phase,
                index: ev.index,
                total: ev.total,
                file: ev.file,
                message: ev.message || state.message,
              });
            },
          });
          Object.assign(state, {
            running: false,
            phase: summary.stopError ? 'partial' : 'done',
            results: summary.results,
            error: summary.stopError ?? null,
            errorCode: summary.stopCode ?? null,
            message: summary.stopError
              ? `Subidos ${summary.uploadedCount}. Detenido en ${summary.stoppedAt}: ${summary.stopError}`
              : `Completado: ${summary.totalTracked} Shorts publicados o programados en YouTube.`,
          });
        } catch (err) {
          Object.assign(state, { running: false, phase: 'error', error: err.message, message: err.message });
        } finally {
          await engineCtx?.close().catch(() => {});
        }
      })();
      return sendJson(response, 202, { started: true, batch: state });
    }
    const pubUploadMatch = /^\/api\/jobs\/([a-f0-9-]+)\/publication\/(clip-\d+\.mp4)\/upload$/.exec(pathname);
    if (pubUploadMatch && request.method === 'POST') {
      const [, id, file] = pubUploadMatch;
      const body = await readStudioRequest(request, 5000);
      const path = await getClipFile(id, file);
      if (!path) throw new RequestError(404, 'El clip no está disponible.');
      const job = await getJob(id);
      let engineCtx = null;
      try {
        const engine = await resolveOptionalEngine(body.provider || job.provider, body.model ?? job.modelId);
        engineCtx = await openJobInference(engine, dirname(path));
        const res = await uploadSingleClipWithSeo(id, file, {
          infer: engineCtx.infer,
          channelId: body.channelId,
          immediate: body.immediate !== false,
          publishAtIso: typeof body.publishAtIso === 'string' ? body.publishAtIso : undefined,
          forceSeo: body.forceSeo === true,
        });
        return sendJson(response, 200, res);
      } finally {
        await engineCtx?.close().catch(() => {});
      }
    }
    const publicationMatch = /^\/api\/jobs\/([a-f0-9-]+)\/publication\/(clip-\d+\.mp4)$/.exec(pathname);
    if (publicationMatch && ['GET', 'POST'].includes(request.method)) {
      const [, id, file] = publicationMatch;
      const body = request.method === 'POST' ? await readStudioRequest(request, 9000) : null;
      const path = await getClipFile(id, file);
      if (!path) throw new RequestError(404, 'El clip no está disponible.');
      const job = await getJob(id);
      const clip = job.clips.find((entry) => entry.file === file);
      if (body) return sendJson(response, 200, await savePublicationDraft(dirname(path), clip, body));
      return sendJson(response, 200, await loadPublication(dirname(path), job, clip));
    }
    const sourceMediaMatch = /^\/media\/([a-f0-9-]+)\/source$/.exec(pathname);
    if (sourceMediaMatch) return await serveSource(request, response, sourceMediaMatch[1]);
    const mediaMatch = /^\/media\/([a-f0-9-]+)\/(clip-\d+\.mp4)$/.exec(pathname);
    if (mediaMatch) return await serveClip(request, response, mediaMatch[1], mediaMatch[2]);
    const thumbMatch = /^\/media\/([a-f0-9-]+)\/(clip-\d+-thumb\.jpg)$/.exec(pathname);
    if (thumbMatch && ['GET', 'HEAD'].includes(request.method)) {
      const clipPath = await getClipFile(thumbMatch[1], thumbMatch[2].replace('-thumb.jpg', '.mp4'));
      if (!clipPath) throw new RequestError(404, 'Miniatura no disponible.');
      const img = await readFile(join(dirname(clipPath), thumbMatch[2])).catch(() => { throw new RequestError(404, 'Miniatura aún no generada.'); });
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(request.method === 'HEAD' ? undefined : img);
    }
    const subtitleMatch = /^\/media\/([a-f0-9-]+)\/(clip-\d+)\.ass$/.exec(pathname);
    if (subtitleMatch) return await serveSubtitles(request, response, subtitleMatch[1], subtitleMatch[2]);

    const entry = files.get(pathname);
    if (!entry || !['GET', 'HEAD'].includes(request.method)) throw new RequestError(404, 'Recurso no encontrado.');
    const [file, contentType] = entry;
    const content = await readFile(new URL(`dist/${file}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!response.headersSent && !response.destroyed) {
      sendJson(response, error.status ?? 500, { error: error.status ? error.message : 'El servidor local no pudo completar la petición.', code: error.code });
    }
  }
}).listen(port, host, () => {
  console.log(`Corte Studio está disponible en ${origin}`);
  void exportAllProjects()
    .then(({ projects, files }) => console.log(`Vídeos al día en ${exportRoot}: ${projects} proyectos, ${files} archivos nuevos.`))
    .catch((error) => console.warn('No se pudo preparar la carpeta de vídeos:', error.message));
  if (geminiKey) console.log('Gemini listo.');
  if (openRouterKey) console.log(`OpenRouter listo (${defaultOpenRouterModel}).`);
});
