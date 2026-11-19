import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { cancelAllJobs, getJob, jobsDir, resumeJob, saveJobRecord, subscribeJobEvents } from '../pipeline/jobs.mjs';
import { dataDir, getMediaTools, probeVideo, renderSummaryVideo, summaryPartGraph } from '../pipeline/media.mjs';
import {
  SUMMARY_CARDS, SUMMARY_FPS, assemble, buildRangeParts, chapterListing, dedupeBeats, fitBudget, formatTimestamp, normalizeBeats, planSummary, resolveSummaryTarget,
} from '../pipeline/summary.mjs';

// Vídeo sintético: 600 s, segmentos de unos 5 s separados por 0,4 s, con una pausa larga cada 10 segmentos.
function syntheticTranscript(duration = 600) {
  const segments = [];
  let cursor = 1;
  while (cursor + 5 < duration) {
    const id = segments.length + 1;
    const text = `Frase número ${id} con contenido suficiente para ser transcrita.`;
    const start = cursor;
    const end = cursor + 5;
    const words = text.split(' ').map((word, index, list) => ({
      start: Number((start + index * (5 / list.length)).toFixed(3)),
      end: Number((start + (index + 1) * (5 / list.length)).toFixed(3)),
      text: word,
    }));
    segments.push({ id, start, end, text, words, energy: 3 + (id % 7), wps: 2.2, pauseBefore: 0.4 });
    cursor = end + (id % 10 === 0 ? 3.2 : 0.4);
  }
  return { language: 'es', segments };
}

function mockEngine(transcript) {
  const calls = { beats: 0, director: 0 };
  const infer = async ({ schema, parts }) => {
    const payload = JSON.parse(parts[0].text);
    if (schema.properties.beats) {
      calls.beats++;
      const ids = payload.segments.map(({ id }) => id);
      const beats = [];
      for (let index = 0; index + 5 < ids.length; index += 6) {
        beats.push({
          startSegmentId: ids[index], endSegmentId: ids[index + 5], importance: 3 + ((index / 6) % 8), appeal: 5,
          kind: 'explicacion', topic: `Tema ${Math.floor(index / 24)}`, summary: `Pasaje que empieza en el segmento ${ids[index]}`,
        });
      }
      return { beats };
    }
    calls.director++;
    const ranked = [...payload.beats].sort((a, b) => b.value - a.value);
    let total = 0;
    const picked = [];
    for (const beat of ranked) {
      if (total + beat.duration > payload.targetSeconds * 1.4) continue;
      picked.push(beat);
      total += beat.duration;
    }
    picked.sort((a, b) => a.start - b.start);
    return {
      selected: picked.map((beat, index) => ({ id: beat.id, chapter: `Capítulo ${Math.floor(index / 3) + 1}`, card: `Aquí empieza el tramo ${beat.id}` })),
      intro: 'En este vídeo se resume una charla larga',
      title: 'Resumen de una charla larga',
      description: 'Los momentos clave de la charla.',
    };
  };
  return { infer, calls };
}

test('buildRangeParts quita el aire muerto, no corta frases y encaja en fotogramas', () => {
  const segments = [
    { id: 1, start: 10, end: 14 }, { id: 2, start: 14.3, end: 18 },
    { id: 3, start: 22, end: 26 }, { id: 4, start: 26.2, end: 30 },
  ];
  const parts = buildRangeParts(segments, 0, 3, 120);
  assert.equal(parts.length, 2, 'la pausa de 4 s se corta');
  assert.ok(parts[0].start <= 10 && parts[0].start >= 9.7, 'entra justo antes de la primera palabra');
  assert.ok(parts[0].end >= 18 && parts[0].end <= 18.5, 'conserva la cola de la frase');
  assert.ok(parts[1].start <= 22 && parts[1].start > 21.5);
  for (const part of parts) {
    assert.ok(Math.abs(part.duration * SUMMARY_FPS - Math.round(part.duration * SUMMARY_FPS)) < 1e-6, 'duración en fotogramas exactos');
    assert.ok(part.end > part.start);
  }
});

test('fitBudget se acerca al objetivo, mantiene el orden y los cortes caen en límites de frase', () => {
  const transcript = syntheticTranscript();
  const segments = transcript.segments;
  const indexById = new Map(segments.map((segment, index) => [segment.id, index]));
  const raw = [];
  for (let index = 0; index + 5 < segments.length; index += 6) {
    raw.push({ startSegmentId: segments[index].id, endSegmentId: segments[index + 5].id, importance: 2 + ((index / 6) * 3) % 9, appeal: 5, kind: 'historia', topic: 't', summary: 's' });
  }
  const beats = dedupeBeats(normalizeBeats(raw, segments, indexById, 600));
  const target = 150;
  const chosen = fitBudget(beats, target, segments, 600);
  const { ranges, total } = assemble(chosen, segments, 600);
  assert.ok(total >= target * 0.85 && total <= target * 1.06, `duración ${total.toFixed(1)} s cerca de ${target} s`);
  const starts = ranges.flatMap((range) => range.parts.map((part) => part.start));
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'cronológico');
  for (const range of ranges) {
    for (const part of range.parts) {
      const insideWord = segments.some((segment) => segment.words.some((word) => part.start > word.start + 0.02 && part.start < word.end - 0.02));
      assert.equal(insideWord, false, `el tramo ${part.start} no empieza a mitad de palabra`);
    }
  }
  let cursor = 0;
  for (const part of ranges.flatMap((range) => range.parts)) {
    assert.ok(Math.abs(part.outStart - cursor) < 1e-3, 'la línea de tiempo es continua');
    cursor += part.duration;
  }
});

test('planSummary de un vídeo largo genera capítulos desde 0:00 y tarjetas de contexto espaciadas', async () => {
  const transcript = syntheticTranscript(3600);
  const { infer, calls } = mockEngine(transcript);
  const messages = [];
  const target = resolveSummaryTarget(3600, 17);
  assert.equal(target, 1020);
  const plan = await planSummary(infer, transcript, { duration: 3600 }, async (message) => { messages.push(message); }, { target, sourceTitle: 'Charla' });
  assert.ok(calls.beats >= 2, 'analiza por ventanas');
  assert.equal(calls.director, 1, 'una sola llamada de dirección');
  assert.ok(plan.outputSeconds >= target * 0.85 && plan.outputSeconds <= target * 1.06, `salida ${plan.outputSeconds}`);
  assert.ok(plan.outputSeconds < plan.sourceSeconds / 2);
  assert.equal(plan.chapters[0].outStart, 0);
  assert.ok(plan.chapters.length >= 3);
  assert.ok(plan.chapters.length <= Math.max(3, Math.round(plan.outputSeconds / 90)), 'pocos capítulos');
  for (let index = 1; index < plan.chapters.length; index++) assert.ok(plan.chapters[index].outStart - plan.chapters[index - 1].outStart >= 25);
  const cards = plan.parts.filter((part) => part.card);
  assert.equal(plan.parts[0].card?.kind, 'intro', 'abre con tarjeta de introducción');
  assert.equal(cards.length, plan.cardCount);
  for (let index = 1; index < cards.length; index++) {
    assert.ok(cards[index].outStart - cards[index - 1].outStart >= SUMMARY_CARDS.minGapSeconds - 1, 'tarjetas separadas');
  }
  for (const part of cards) {
    assert.ok(part.card.seconds <= part.duration - 1.1, 'la tarjeta cabe en el tramo');
    assert.ok(part.card.text.length > 0 && part.card.text.length <= 96);
  }
  assert.match(chapterListing(plan.chapters).split('\n')[0], /^0:00 /);
  assert.equal(formatTimestamp(3725), '1:02:05');
  assert.ok(messages.length > 3);
});

test('planSummary usa la selección por valor si el director falla y rechaza vídeos demasiado cortos', async () => {
  const transcript = syntheticTranscript(900);
  const { infer } = mockEngine(transcript);
  const flaky = async (request) => {
    if (request.schema.properties.selected) throw new Error('sin respuesta');
    return infer(request);
  };
  const plan = await planSummary(flaky, transcript, { duration: 900 }, async () => {}, { target: 200 });
  assert.ok(plan.outputSeconds >= 170 && plan.outputSeconds <= 215);
  assert.ok(plan.parts.length >= 2);
  assert.throws(() => resolveSummaryTarget(50, 0), /demasiado corto/);
});

test('summaryPartGraph desenfoca, baja el volumen y vuelve a la normalidad en las tarjetas', () => {
  const card = summaryPartGraph({ duration: 20, card: { text: 'Aquí intenta robar una tienda', seconds: 3.4, kind: 'chapter' } },
    { width: 1920, height: 1080, hasSubtitles: true, subtitlePath: 'summary-parts/p0001.ass' });
  assert.match(card, /gblur=sigma=5/);
  assert.match(card, /fade=t=out:st=2\.500:d=0\.900:alpha=1/);
  assert.match(card, /volume='clip\(0\.12\+/);
  assert.match(card, /ass=summary-parts\/p0001\.ass/);
  const plain = summaryPartGraph({ duration: 8 }, { width: 1920, height: 1080, hasSubtitles: false });
  assert.doesNotMatch(plain, /gblur|volume=/);
  assert.match(plain, /afade=t=out/);
});

test('renderSummaryVideo une los tramos con tarjetas, capítulos y duración exacta', async (t) => {
  await mkdir(dataDir, { recursive: true });
  const dir = await mkdtemp(join(dataDir, 'verify-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    await rmdir(dir).catch(() => {});
  });
  const { ffmpeg } = await getMediaTools();
  const source = join(dir, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const words = (start, text) => text.split(' ').map((word, index) => ({ start: start + index * 0.4, end: start + index * 0.4 + 0.35, text: word }));
  const transcript = { language: 'es', segments: [
    { id: 1, start: 2, end: 5.5, text: 'esto es una frase de prueba larga', words: words(2, 'esto es una frase de prueba larga') },
    { id: 2, start: 12, end: 15.5, text: 'otra parte del vídeo con subtítulos', words: words(12, 'otra parte del vídeo con subtítulos') },
    { id: 3, start: 22, end: 25.5, text: 'y una tercera parte para cerrar', words: words(22, 'y una tercera parte para cerrar') },
  ] };
  const parts = [[1.8, 6], [11.8, 16], [21.8, 26]].map(([start, end], index) => ({
    start, end, duration: Number((end - start).toFixed(4)), outStart: index * 4.2,
    ...(index < 2 ? { card: { text: index ? 'Aquí cambia de tema' : 'En este vídeo se prueba el resumen', seconds: 2.4, kind: index ? 'chapter' : 'intro' } } : {}),
  }));
  const total = parts.reduce((sum, part) => sum + part.duration, 0);
  const plan = { parts, outputSeconds: total, chapters: [{ title: 'Inicio', outStart: 0 }, { title: 'Final', outStart: 8.4 }] };
  const progress = [];
  const format = normalizeFormat({ ratio: '16:9', layouts: ['fit'], fitCrop: 'original' });
  const file = await renderSummaryVideo(source, dir, plan, transcript, format, { onProgress: ({ done }) => progress.push(done) });
  assert.equal(file, 'clip-1.mp4');
  assert.deepEqual(progress.sort(), [1, 2, 3]);
  const media = await probeVideo(join(dir, file));
  assert.ok(Math.abs(media.duration - total) < 0.35, `duración ${media.duration} cerca de ${total}`);
  assert.ok(media.audio);
  assert.equal((await readdir(dir)).includes('summary-parts'), false, 'limpia los tramos temporales');
});

test('un proyecto en modo resumen se completa de principio a fin con motor simulado', async (t) => {
  const id = randomUUID();
  const directory = join(jobsDir, id);
  await mkdir(directory, { recursive: true });
  t.after(async () => {
    const job = await getJob(id);
    if (job && !['done', 'error'].includes(job.stage)) await cancelAllJobs();
    await rm(directory, { recursive: true, force: true });
  });
  const { ffmpeg } = await getMediaTools();
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=120', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=120',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', join(directory, 'source.mp4')]);
  const segments = Array.from({ length: 15 }, (_, index) => {
    const start = 2 + index * 7.5;
    const text = `Esta es la frase ${index + 1} del vídeo largo de prueba`;
    return {
      id: index + 1, start, end: start + 6, text,
      words: text.split(' ').map((word, position, list) => ({ start: start + position * (6 / list.length), end: start + (position + 1) * (6 / list.length), text: word })),
    };
  });
  await writeFile(join(directory, 'transcript.json'), JSON.stringify({ language: 'es', segments }));
  await saveJobRecord({ id, videoId: 'resumenvid1', title: 'Charla de prueba', provider: 'gemini', stage: 'error', mode: 'summary',
    summaryOptions: { targetMinutes: 0, captions: true }, clips: [], sourceReady: true, format: normalizeFormat({ ratio: '16:9', layouts: ['fit'], fitCrop: 'original' }) });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    const properties = request.generationConfig.responseJsonSchema.properties;
    const payload = JSON.parse(request.contents[0].parts[0].text);
    let value;
    if (properties.beats) {
      const ids = payload.segments.map(({ id: segmentId }) => segmentId);
      value = { beats: [] };
      for (let index = 0; index + 2 < ids.length; index += 3) {
        value.beats.push({ startSegmentId: ids[index], endSegmentId: ids[index + 2], importance: 5 + (index % 5), appeal: 6, kind: 'historia', topic: `Tema ${index}`, summary: 'Pasaje de prueba' });
      }
    } else {
      value = {
        selected: payload.beats.slice(0, 4).map((beat, index) => ({ id: beat.id, chapter: `Parte ${Math.floor(index / 2) + 1}`, card: `Aquí empieza el pasaje ${beat.id}` })),
        intro: 'En este vídeo se prueba el resumen', title: 'Resumen de la charla de prueba', description: 'Lo más importante de la charla.',
      };
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
  });
  let unsubscribe;
  const stages = new Set();
  const finished = new Promise((resolve) => {
    unsubscribe = subscribeJobEvents((job) => {
      if (job.id !== id) return;
      stages.add(job.stage);
      if (['done', 'error'].includes(job.stage)) resolve(job);
    });
  });
  try {
    await resumeJob(id, { provider: 'gemini', key: 'fake' });
    const job = await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error('El resumen de prueba no terminó.')), 240000).unref())]);
    assert.equal(job.stage, 'done', job.message);
    assert.match(job.message, /^Resumen listo: /);
    assert.deepEqual(job.clips.map(({ file }) => file), ['clip-1.mp4']);
    assert.equal(job.clips[0].longForm, true);
    assert.equal(job.clips[0].ratio, '16:9');
    assert.ok(job.summary.partCount >= 2 && job.summary.outputSeconds < 120);
    assert.equal(job.summary.parts.length, job.summary.partCount);
    assert.equal(job.summary.parts[0][2], 'intro', 'la primera tarjeta es la introducción');
    assert.equal(job.summaryProgress, null);
    assert.equal(job.activeFramingClip, undefined, 'no usa el encuadre de clips verticales');
    assert.equal(job.candidates.length, 1);
    assert.equal(job.canSearchMore, false);
    const media = await probeVideo(join(directory, 'clip-1.mp4'));
    assert.ok(Math.abs(media.duration - job.summary.outputSeconds) < 0.5, `duración ${media.duration}`);
    const draft = JSON.parse(await readFile(join(directory, 'clip-1-youtube-draft.json'), 'utf8'));
    assert.equal(draft.title, 'Resumen de la charla de prueba');
    assert.doesNotMatch(draft.title, /#Shorts/i);
    assert.deepEqual(stages.has('rendering') && stages.has('selecting'), true);
    const saved = await getJob(id);
    assert.equal(saved.canSearchMore, false);
    assert.equal(saved.mode, 'summary');
  } finally {
    unsubscribe();
  }
});
