import { setTimeout as wait } from 'node:timers/promises';
import { RequestError } from './errors.mjs';
import { parseModelJson } from './gemini.mjs';
import { cancelError } from './media.mjs';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

export const openRouterModels = [
  { id: 'particle-ai/particle-1:free', label: 'Particle 1 (gratis)', strictSchema: true },
  { id: 'inclusionai/ling-3.2-flash:free', label: 'Ling 3.2 Flash (gratis)', strictSchema: true },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (gratis)', strictSchema: false },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B (gratis)', strictSchema: false },
];

export const defaultOpenRouterModel = process.env.CORTE_OPENROUTER_MODEL?.trim() || openRouterModels[0].id;

function buildCandidateChain(preferred) {
  const ordered = [
    openRouterModels.find((entry) => entry.id === preferred) ?? { id: preferred, label: preferred, strictSchema: true },
    ...openRouterModels.filter((entry) => entry.id !== preferred),
  ];
  return ordered;
}

async function callOpenRouter(key, candidate, { system, parts, schema, maxOutputTokens, signal }) {
  if (signal?.aborted) throw cancelError();
  const content = parts.map(({ text, inline_data: image }) => image
    ? { type: 'image_url', image_url: { url: `data:${image.mime_type};base64,${image.data}` } }
    : { type: 'text', text });

  const systemText = candidate.strictSchema
    ? system
    : `${system ?? ''}\n\nDevuelve únicamente un objeto JSON válido que cumpla este esquema:\n${JSON.stringify(schema)}`.trim();

  const responseFormat = candidate.strictSchema
    ? { type: 'json_schema', json_schema: { name: 'corte_response', strict: true, schema } }
    : { type: 'json_object' };

  const reqSignal = signal ? AbortSignal.any([AbortSignal.timeout(180_000), signal]) : AbortSignal.timeout(180_000);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'http://127.0.0.1:4173',
      'X-Title': 'Corte Studio',
    },
    signal: reqSignal,
    redirect: 'error',
    body: JSON.stringify({
      model: candidate.id,
      messages: [
        ...(systemText ? [{ role: 'system', content: systemText }] : []),
        { role: 'user', content },
      ],
      temperature: 0.25,
      max_tokens: Math.min(8192, maxOutputTokens),
      reasoning: { enabled: false },
      response_format: responseFormat,
    }),
  }).catch((error) => {
    if (signal?.aborted) throw cancelError();
    throw new RequestError(502, error.name === 'TimeoutError' ? 'OpenRouter agotó el tiempo de espera.' : 'No se pudo conectar con OpenRouter.');
  });

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new RequestError(403, 'OpenRouter rechazó la clave de API.');
  }
  if ([429, 500, 502, 503, 504].includes(response.status)) {
    const detail = await response.text().catch(() => '');
    const err = new RequestError(response.status, `OpenRouter respondió con HTTP ${response.status} en ${candidate.id}. ${detail.slice(0, 120)}`.trim());
    err.retryable = true;
    throw err;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new RequestError(502, `OpenRouter rechazó la petición (${response.status}): ${detail.slice(0, 140)}`.trim());
  }

  const output = await response.json().catch(() => null);
  const choice = output?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new RequestError(502, 'OpenRouter dejó la respuesta a medias.');
  return parseModelJson(choice?.message?.content);
}

export async function openRouterJson(key, { system, parts, schema, maxOutputTokens = 4096, model = defaultOpenRouterModel, signal }) {
  const candidates = buildCandidateChain(model);
  let lastError;
  for (const [index, candidate] of candidates.entries()) {
    try {
      return await callOpenRouter(key, candidate, { system, parts, schema, maxOutputTokens, signal });
    } catch (error) {
      if (error.code === 'CANCELLED' || error.status === 403 || signal?.aborted) throw error;
      lastError = error;
      if (index < candidates.length - 1 && (error.retryable || error.status === 502)) {
        await wait(600, undefined, signal ? { signal } : undefined).catch(() => {});
        if (signal?.aborted) throw cancelError();
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new RequestError(502, 'OpenRouter no pudo completar el análisis.');
}
