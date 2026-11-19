import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapLimit } from '../pipeline/analysis.mjs';
import { createTelemetry, exportTelemetry, markStage, recordUsage } from '../pipeline/telemetry.mjs';

test('mapLimit ejecuta en paralelo respetando el límite de concurrencia y mantiene el orden', async () => {
  let running = 0;
  let peak = 0;
  const items = [10, 20, 30, 40, 50, 60];
  const out = await mapLimit(items, 3, async (value) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return value * 2;
  });
  assert.deepEqual(out, [20, 40, 60, 80, 100, 120]);
  assert.ok(peak <= 3 && peak >= 2, `peak concurrency expected 2..3, got ${peak}`);
});

test('telemetry acumula tokens, coste estimado y tiempos por fase', async () => {
  const t = createTelemetry('gemini');
  markStage(t, 'selecting');
  await new Promise((r) => setTimeout(r, 12));
  recordUsage(t, { inputTokens: 100_000, outputTokens: 10_000 });
  recordUsage(t, { inputTokens: 50_000, outputTokens: 5_000 });
  const summary = exportTelemetry(t);
  assert.equal(summary.calls, 2);
  assert.equal(summary.tokensIn, 150_000);
  assert.equal(summary.tokensOut, 15_000);
  assert.ok(summary.estimatedCostUsd > 0);
  assert.ok(summary.stageTimingsMs.selecting >= 5);
});

test('cola FIFO persistente: encola, reordena, pausa y extrae en orden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'corte-queue-'));
  process.env.CORTE_QUEUE_FILE = join(dir, 'queue.json');
  const queueMod = await import(`../pipeline/queue.mjs?t=${Date.now()}`);
  try {
    const a = await queueMod.enqueueJob({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mode: 'normal' });
    const b = await queueMod.enqueueJob({ url: 'https://www.youtube.com/watch?v=abcdefghijk', mode: 'prototype' });
    let state = await queueMod.loadQueue();
    assert.equal(state.items.length, 2);

    state = await queueMod.reorderQueue([b.item.queueId, a.item.queueId]);
    assert.equal(state.items[0].queueId, b.item.queueId);

    await queueMod.setQueuePaused(true);
    assert.equal(await queueMod.popNextQueuedJob(), null);

    await queueMod.setQueuePaused(false);
    const popped = await queueMod.popNextQueuedJob();
    assert.equal(popped.queueId, b.item.queueId);

    await queueMod.removeQueuedJob(a.item.queueId);
    state = await queueMod.loadQueue();
    assert.equal(state.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
