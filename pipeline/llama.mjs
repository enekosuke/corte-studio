import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import { RequestError } from './errors.mjs';
import { parseModelJson } from './gemini.mjs';
import { cancelError, dataDir, killProcessTree } from './media.mjs';

const execFileAsync = promisify(execFile);
const host = '127.0.0.1';
const binary = resolve(process.env.CORTE_LLAMA_SERVER || join(dataDir, 'llama.cpp', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'));
const modelRoots = [join(dataDir, 'models', 'local'), join(homedir(), '.lmstudio', 'models')];
const projectorPattern = /^mmproj.*\.gguf$/i;
const activeStops = new Set();
let gpuDevice;

export function abortLlamaProcesses() {
  for (const stop of activeStops) stop();
}

async function detectGpuDevice() {
  const configured = process.env.CORTE_LLAMA_DEVICE?.trim();
  if (configured) return configured.toLowerCase() === 'auto' ? null : configured;
  gpuDevice ??= execFileAsync(binary, ['--list-devices'], { cwd: dirname(binary), windowsHide: true, timeout: 10_000 })
    .then(({ stdout }) => /^\s*(CUDA\d+|Vulkan\d+):/m.exec(stdout)?.[1] ?? null)
    .catch(() => null);
  return gpuDevice;
}

export async function listLlamaModels() {
  try { await access(binary); } catch { return []; }
  const models = [];
  for (const root of modelRoots) {
    const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const files = entries.filter((entry) => entry.isFile() && /\.gguf$/i.test(entry.name));
    const projectors = new Map();
    for (const entry of files.filter((file) => projectorPattern.test(file.name))) {
      if (!projectors.has(entry.parentPath) || /^mmproj-BF16\.gguf$/i.test(entry.name)) {
        projectors.set(entry.parentPath, join(entry.parentPath, entry.name));
      }
    }
    for (const { name, parentPath } of files) {
      if (projectorPattern.test(name) || /^mtp[-_]/i.test(name) || !projectors.has(parentPath)) continue;
      const path = join(parentPath, name);
      const id = createHash('sha256').update(path).digest('hex').slice(0, 20);
      const label = name.slice(0, -5).replace(/^gemma-4-(\d+B)(-A4B)?-it-qat-UD-(.+)$/i, (_match, size, moe, format) =>
        `Gemma 4 ${size.toUpperCase()}${moe ? ' A4B' : ''} · ${format}`);
      models.push({ id, label, path, projector: projectors.get(parentPath) });
    }
  }
  return models.sort((a, b) => Number(b.label.startsWith('Gemma 4 26B')) - Number(a.label.startsWith('Gemma 4 26B')) || a.label.localeCompare(b.label));
}

function choosePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

export async function startLlama(model, jobDir, { signal } = {}) {
  if (signal?.aborted) throw cancelError();
  const port = await choosePort();
  const token = randomBytes(24).toString('hex');
  const origin = `http://${host}:${port}`;
  const [device, projectorStats] = await Promise.all([detectGpuDevice(), stat(model.projector).catch(() => null)]);
  if (signal?.aborted) throw cancelError();
  const projectorMiB = Math.ceil((projectorStats?.size ?? 0) / (1024 * 1024));
  // Reserve headroom for the multimodal projector and vision compute buffers so --fit does not spill them to shared RAM.
  const fitTarget = process.env.CORTE_LLAMA_FIT_TARGET || String(Math.max(768, projectorMiB + 512));
  const args = [
    '--host', host, '--port', String(port), '--alias', 'corte-local', '--api-key', token, '--no-webui',
    '--model', model.path, '--mmproj', model.projector, '--ctx-size', '16384', '--parallel', '1',
    ...(device ? ['--device', device, '--mmproj-device', device] : []),
    '--flash-attn', 'on', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0',
    '--load-mode', 'none', '--fit-target', fitTarget, '--reasoning', 'off',
  ];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^CORTE_(GEMINI_API_KEY|OPENROUTER_API_KEY|LM_STUDIO_TOKEN)/i.test(name)));
  const child = spawn(binary, args, { cwd: dirname(binary), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let failed = false;
  child.stdout.resume();
  child.stderr.setEncoding('utf8').on('data', (chunk) => { log = (log + chunk).slice(-14000); });
  child.once('error', (error) => { failed = true; log += error.message; });
  const finished = new Promise((resolveExit) => child.once('close', resolveExit));
  const stop = () => killProcessTree(child);
  const shutdown = () => { stop(); process.exit(0); };
  activeStops.add(stop);
  signal?.addEventListener('abort', stop, { once: true });
  process.once('exit', stop);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  async function close() {
    stop();
    await finished;
    activeStops.delete(stop);
    signal?.removeEventListener('abort', stop);
    process.off('exit', stop);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await writeFile(join(jobDir, 'llama.log'), log.replaceAll(token, '[oculto]'), 'utf8').catch(() => {});
  }

  try {
    const deadline = Date.now() + 180_000;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    while (!failed && !signal?.aborted && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      const probeSignal = signal ? AbortSignal.any([AbortSignal.timeout(1200), signal]) : AbortSignal.timeout(1200);
      const check = await fetch(`${origin}/v1/models`, { headers, redirect: 'error', signal: probeSignal }).catch(() => null);
      if (signal?.aborted) break;
      if (check?.ok && (await check.json()).data?.some(({ id }) => id === 'corte-local')) {
        const healthSignal = signal ? AbortSignal.any([AbortSignal.timeout(1200), signal]) : AbortSignal.timeout(1200);
        const health = await fetch(`${origin}/health`, { headers, redirect: 'error', signal: healthSignal }).catch(() => null);
        if (!health?.ok) { await wait(500, undefined, signal ? { signal } : undefined).catch(() => {}); continue; }
        console.log(`llama.cpp listo (${model.label}${device ? `; ${device}` : ''}; PID ${child.pid}).`);
        return {
          close,
          infer: async ({ system, parts, schema, maxOutputTokens = 4096 }) => {
            if (signal?.aborted) throw cancelError();
            const content = parts.map(({ text, inline_data: image }) => image
              ? { type: 'image_url', image_url: { url: `data:${image.mime_type};base64,${image.data}` } }
              : { type: 'text', text });
            const inferSignal = signal ? AbortSignal.any([AbortSignal.timeout(240_000), signal]) : AbortSignal.timeout(240_000);
            const response = await fetch(`${origin}/v1/chat/completions`, {
              method: 'POST', headers, redirect: 'error', signal: inferSignal,
              body: JSON.stringify({
                model: 'corte-local', messages: [{ role: 'system', content: system }, { role: 'user', content }],
                response_format: { type: 'json_schema', schema }, temperature: 0.1, max_tokens: Math.min(3072, maxOutputTokens),
              }),
            }).catch((error) => {
              if (signal?.aborted) throw cancelError();
              throw new RequestError(502, error.name === 'TimeoutError' ? 'El modelo local agotó el tiempo de espera.' : 'Se perdió la conexión con llama.cpp.');
            });
            if (!response.ok) throw new RequestError(502, `llama.cpp rechazó el análisis (HTTP ${response.status}).`);
            const result = (await response.json()).choices?.[0];
            if (result?.finish_reason === 'length') throw new RequestError(502, 'El modelo local dejó la respuesta a medias.');
            return parseModelJson(result?.message?.content);
          },
        };
      }
      await wait(500, undefined, signal ? { signal } : undefined).catch(() => {});
    }
    if (signal?.aborted) throw cancelError();
    throw new RequestError(502, 'llama.cpp no pudo cargar el modelo. Revisa llama.log en la carpeta del trabajo.');
  } catch (error) {
    await close();
    throw error;
  }
}
