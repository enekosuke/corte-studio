import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseClips } from '../pipeline/analysis.mjs';
import { dedupeSystem, editorSystem, reviewSystem } from '../pipeline/prompts.mjs';

// Transcripción de `groups` bloques de 6 frases de 5 s cada 6 s (36 s por bloque, un buen momento por bloque).
function longTranscript(groups) {
  const segments = Array.from({ length: groups * 6 }, (_, index) => ({
    id: index + 1, start: index * 6, end: index * 6 + 5, text: `Frase ${index + 1} con contenido de sobra para que el análisis la acepte.`, energy: 5, wps: 2, pauseBefore: 0,
  }));
  return { language: 'es', segments };
}

/** Motor simulado: cada ventana devuelve un clip por bloque de 6 frases; la revisión aprueba todo salvo lo que pida `reject`. */
function engine({ reject = () => false, dedupe = null } = {}) {
  const calls = { windows: 0, reviews: [], dedupes: 0 };
  const infer = async ({ schema, system, parts }) => {
    const payload = JSON.parse(parts[0].text);
    if (schema.properties.clips) {
      calls.windows++;
      const ids = payload.segments.map(({ id }) => id);
      const clips = [];
      for (const id of ids) {
        if (id % 6 !== 1 || !ids.includes(id + 5)) continue; // cada ventana devuelve los bloques completos que contiene
        clips.push({
          startSegmentId: id, endSegmentId: id + 5, title: `Momento número ${id}`, onScreenHook: `Pasa algo en el bloque ${id}`,
          category: 'humor', reason: 'Tensión y remate.', hookScore: 9, retentionScore: 9, shareScore: 9, clarityScore: 9, score: 9 - (id % 7) * 0.1,
        });
      }
      return { clips };
    }
    if (system === dedupeSystem) {
      calls.dedupes++;
      return { selected: dedupe ? dedupe(payload.clips) : payload.clips.map(({ id }) => id) };
    }
    calls.reviews.push(payload.candidates.length);
    return { selected: payload.candidates.filter((item) => !reject(item)).map(({ id }) => id) };
  };
  return { infer, calls };
}

const media = (transcript) => ({ duration: transcript.segments.at(-1).end + 5 });

test('los prompts no imponen cuota: el número de clips lo decide el contenido', () => {
  assert.match(editorSystem, /No hay límite de cantidad/);
  assert.match(editorSystem, /0, 3 o 15/);
  assert.match(reviewSystem, /no hay cuota ni límite de cantidad/);
  assert.match(reviewSystem, /conservar 30 o conservar 5 es correcto/);
  assert.doesNotMatch(reviewSystem, /SOLO con la élite/);
  assert.match(reviewSystem, /NO son duplicados/);
  assert.match(dedupeSystem, /NO son repetidos/);
  assert.match(dedupeSystem, /No quites clips por ser demasiados/);
});

test('un vídeo con 62 buenos momentos devuelve los 62, revisados por lotes sin perder ninguno', async () => {
  const transcript = longTranscript(62);
  const { infer, calls } = engine();
  const progress = [];
  const result = await chooseClips(infer, transcript, media(transcript), async (message) => { progress.push(message); });
  assert.equal(result.length, 62, `salieron ${result.length}`);
  assert.equal(new Set(result.map(({ start }) => start)).size, 62, 'ninguno repetido');
  assert.deepEqual(calls.reviews, [25, 25, 12], 'revisión en lotes de 25');
  assert.equal(calls.dedupes, 1, 'una pasada ligera contra repetidos entre lotes');
  assert.ok(progress.some((message) => /lote 2 de 3/.test(message)));
  assert.deepEqual(result.map(({ score }) => score), [...result.map(({ score }) => score)].sort((a, b) => b - a), 'el más fuerte primero');
});

test('con pocos momentos solo hay una revisión y salen los que valen, aunque sean 5', async () => {
  const transcript = longTranscript(7);
  const { infer, calls } = engine({ reject: (item) => item.id === 3 || item.id === 5 });
  const result = await chooseClips(infer, transcript, media(transcript), async () => {});
  assert.equal(calls.reviews.length, 1);
  assert.equal(calls.dedupes, 0);
  assert.equal(result.length, 5, 'siete candidatos menos dos rechazados');
});

test('un chat de 30 momentos aprobados da 30 clips', async () => {
  const transcript = longTranscript(30);
  const { infer } = engine();
  assert.equal((await chooseClips(infer, transcript, media(transcript), async () => {})).length, 30);
});

test('entre lotes solo se quitan los repetidos reales y una respuesta absurda no destruye el trabajo', async () => {
  const transcript = longTranscript(40);
  const repeated = engine({ dedupe: (clips) => clips.filter(({ id }) => id !== 7 && id !== 30).map(({ id }) => id) });
  assert.equal((await chooseClips(repeated.infer, transcript, media(transcript), async () => {})).length, 38, 'quita las dos parejas repetidas');

  const absurd = engine({ dedupe: () => [1] });
  assert.equal((await chooseClips(absurd.infer, transcript, media(transcript), async () => {})).length, 40, 'conservar un solo clip no se acepta');

  const broken = engine();
  const failing = async (request) => {
    if (request.system === dedupeSystem) throw new Error('sin respuesta');
    return broken.infer(request);
  };
  assert.equal((await chooseClips(failing, transcript, media(transcript), async () => {})).length, 40, 'si la pasada falla se conservan todos');

  const cancelled = async (request) => {
    if (request.system === dedupeSystem) throw Object.assign(new Error('cancelado'), { code: 'CANCELLED' });
    return broken.infer(request);
  };
  await assert.rejects(() => chooseClips(cancelled, transcript, media(transcript), async () => {}), { code: 'CANCELLED' });
});

test('con un modelo local los lotes son más pequeños para no desbordar su contexto', async () => {
  const transcript = longTranscript(30);
  const { infer, calls } = engine();
  const localInfer = async (request) => {
    if (request.schema.properties.clips) {
      const result = await infer(request);
      return result;
    }
    return infer(request);
  };
  const result = await chooseClips(localInfer, transcript, media(transcript), async () => {}, true);
  assert.equal(result.length, 30);
  assert.ok(calls.reviews.every((size) => size <= 12), `lotes ${calls.reviews}`);
});
