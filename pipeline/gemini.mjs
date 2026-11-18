import { RequestError } from './errors.mjs';
import { setTimeout as wait } from 'node:timers/promises';

const modelBase = 'https://generativelanguage.googleapis.com/v1beta/models';
const primaryModel = 'gemini-4-hydrogen';
const backupModel = 'gemini-3.8-flash';
let primaryRetryAfter = 0;

export function parseModelJson(content) {
  if (typeof content === 'string') {
    try {
      const data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch {
      // A malformed response must never change a clip or create a file.
    }
  }
  throw new RequestError(502, 'El modelo no devolvió un objeto JSON válido.');
}

async function requestGemini(model, options, retry = 0, signal) {
  if (signal?.aborted) throw new RequestError(499, 'Análisis cancelado por el usuario.', 'CANCELLED');
  let response;
  try {
    const reqSignal = signal ? AbortSignal.any([AbortSignal.timeout(180_000), signal]) : AbortSignal.timeout(180_000);
    response = await fetch(`${modelBase}/${model}:generateContent`, { ...options, signal: reqSignal });
  } catch (error) {
    if (signal?.aborted) throw new RequestError(499, 'Análisis cancelado por el usuario.', 'CANCELLED');
    if (retry < 2) {
      await wait(2000 * (retry + 1), undefined, signal ? { signal } : undefined).catch(() => {});
      return requestGemini(model, options, retry + 1, signal);
    }
    throw new RequestError(502, error.name === 'TimeoutError' ? 'Gemini agotó el tiempo de espera.' : 'No se pudo conectar con la API de Gemini.');
  }
  if ([500, 502, 503, 504].includes(response.status) && retry < 2) {
    const seconds = Number(response.headers.get('Retry-After')) || 0;
    await response.body?.cancel();
    await wait(Math.min(30_000, Math.max(2000 * (retry + 1), seconds * 1000)), undefined, signal ? { signal } : undefined).catch(() => {});
    if (signal?.aborted) throw new RequestError(499, 'Análisis cancelado por el usuario.', 'CANCELLED');
    return requestGemini(model, options, retry + 1, signal);
  }
  return response;
}

export async function geminiJson(key, { system, parts, schema, maxOutputTokens = 4096, thinkingLevel = 'medium', signal }) {
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts }],
      generationConfig: {
        thinkingConfig: { thinkingLevel }, maxOutputTokens,
        responseMimeType: 'application/json', responseJsonSchema: schema,
      },
    }),
    redirect: 'error',
  };
  const model = Date.now() < primaryRetryAfter ? backupModel : primaryModel;
  let response = await requestGemini(model, request, 0, signal);
  if (model === primaryModel && response.status === 503) {
    await response.body?.cancel();
    primaryRetryAfter = Date.now() + 5 * 60_000;
    console.log('Hydrogen no disponible: usando temporalmente Gemini 3.8 Flash con la misma credencial.');
    response = await requestGemini(backupModel, request, 0, signal);
  }
  if (response.status === 402) throw new RequestError(402, 'Gemini agotó los créditos prepago del proyecto. Revisa el proyecto y la facturación en Google AI Studio.');
  if (response.status === 429) throw new RequestError(429, 'Gemini alcanzó la cuota del proyecto. Revisa los límites en Google AI Studio.');
  if (response.status === 503) throw new RequestError(503, 'Gemini sigue temporalmente indisponible tras varios intentos. Pulsa Continuar para reanudar el análisis.');
  if (response.status === 401 || response.status === 403) throw new RequestError(403, 'Google rechazó la clave o el acceso del proyecto. Revisa la clave del perfil en AI Studio.');
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    if (detail?.error?.details?.some?.(({ reason }) => reason === 'API_KEY_INVALID')) {
      throw new RequestError(403, 'La clave de Gemini no es válida. Revisa el perfil en Motor de IA.');
    }
    throw new RequestError(502, `Google respondió con HTTP ${response.status}. Revisa el proyecto en AI Studio.`);
  }

  const output = await response.json().catch(() => null);
  const candidate = output?.candidates?.[0];
  const responseParts = candidate?.content?.parts;
  const content = Array.isArray(responseParts)
    ? responseParts.filter((part) => part && !part.thought && typeof part.text === 'string').map(({ text }) => text).join('')
    : '';
  if (!content && output?.promptFeedback?.blockReason) throw new RequestError(422, 'Gemini no pudo analizar este material. Prueba con otro vídeo.');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new RequestError(502, 'Gemini dejó la respuesta a medias. Vuelve a analizar el vídeo.');
  return parseModelJson(content);
}
