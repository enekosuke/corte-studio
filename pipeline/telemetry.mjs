// Telemetría ligera de inferencia y fases: tokens de entrada/salida, coste estimado y duración por etapa.

const RATES_PER_MILLION = {
  gemini: { input: 0.30, output: 2.50 },
  openrouter: { input: 0.0, output: 0.0 },
  local: { input: 0.0, output: 0.0 },
};

export function createTelemetry(provider = 'gemini') {
  return {
    provider,
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
    estimatedCostUsd: 0,
    stageTimingsMs: {},
    _stageStart: null,
    _stageName: null,
  };
}

export function markStage(telemetry, stage) {
  if (!telemetry) return;
  const now = Date.now();
  if (telemetry._stageName && telemetry._stageStart !== null) {
    const elapsed = Math.max(0, now - telemetry._stageStart);
    telemetry.stageTimingsMs[telemetry._stageName] = (telemetry.stageTimingsMs[telemetry._stageName] ?? 0) + elapsed;
  }
  telemetry._stageName = stage;
  telemetry._stageStart = now;
}

export function recordUsage(telemetry, { inputTokens = 0, outputTokens = 0, provider } = {}) {
  if (!telemetry) return;
  const inTok = Number.isFinite(Number(inputTokens)) ? Math.max(0, Math.round(Number(inputTokens))) : 0;
  const outTok = Number.isFinite(Number(outputTokens)) ? Math.max(0, Math.round(Number(outputTokens))) : 0;
  telemetry.calls += 1;
  telemetry.tokensIn += inTok;
  telemetry.tokensOut += outTok;
  const rate = RATES_PER_MILLION[provider || telemetry.provider] ?? RATES_PER_MILLION.gemini;
  const cost = (telemetry.tokensIn * rate.input + telemetry.tokensOut * rate.output) / 1_000_000;
  telemetry.estimatedCostUsd = Number(cost.toFixed(5));
}

export function exportTelemetry(telemetry) {
  if (!telemetry) return undefined;
  markStage(telemetry, null);
  return {
    provider: telemetry.provider,
    calls: telemetry.calls,
    tokensIn: telemetry.tokensIn,
    tokensOut: telemetry.tokensOut,
    estimatedCostUsd: telemetry.estimatedCostUsd,
    stageTimingsMs: { ...telemetry.stageTimingsMs },
  };
}
