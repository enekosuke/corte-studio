import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { chooseClips } from '../pipeline/analysis.mjs';
import { normalizeBrand } from '../pipeline/brands.mjs';
import {
  buildTimeline, fixWordTimings, hexToAss, highlightSet, mapTime, planColdOpen, planSilenceParts, punchFilter, punchTimes, retarget, timelineChangesClip, timelineCues, trimGraph,
} from '../pipeline/clipfx.mjs';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { dataDir, getMediaTools, measureLoudness, probeVideo, renderClip } from '../pipeline/media.mjs';
import { editorSchema, editorSystem, reviewSystem } from '../pipeline/prompts.mjs';

const word = (start, end, text) => ({ start, end, text });

test('fixWordTimings impone 90 ms por palabra, cierra micro-huecos y no solapa', () => {
  const fixed = fixWordTimings([word(0, 0.02, 'a'), word(0.5, 0.9, 'b'), word(0.95, 1.2, 'c'), word(1.1, 1.5, 'd')]);
  assert.ok(fixed[0].end - fixed[0].start >= 0.09 - 1e-9, 'duración mínima');
  assert.equal(fixed[1].end, fixed[2].start, 'el hueco de 50 ms se cierra');
  assert.ok(fixed.every((entry, index) => index === 0 || entry.start >= fixed[index - 1].start));
  assert.ok(fixed.every((entry, index) => index === fixed.length - 1 || entry.end <= fixed[index + 1].start + 1e-9), 'sin solapes');
  assert.equal(fixWordTimings([word(0, 0.4, 'x'), word(1.0, 1.4, 'y')])[0].end, 0.4, 'un hueco largo se respeta');
});

test('colores y palabras clave se normalizan para ASS', () => {
  assert.equal(hexToAss('#FFE600'), '&H0000E6FF&');
  assert.equal(hexToAss('nope'), '&H0000EAFF&');
  const keys = highlightSet(['¡Minecraft!', '30.000 euros', 'x']);
  assert.ok(keys.has('minecraft') && keys.has('30000') && keys.has('euros'));
  assert.ok(!keys.has('x'), 'una letra suelta no cuenta');
});

test('planSilenceParts recorta pausas largas con respiro y quita la cola final', () => {
  const words = [word(1.0, 1.4, 'uno'), word(1.5, 1.9, 'dos'), word(4.0, 4.4, 'tres'), word(4.5, 5.0, 'cuatro')];
  const clip = { start: 0.8, end: 6.0 };
  const parts = planSilenceParts(words, clip);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0].end - 2.02) < 0.05, 'cola de 0,12 s tras "dos"');
  assert.ok(Math.abs(parts[1].start - 3.92) < 0.05, 'entrada de 0,08 s antes de "tres"');
  assert.ok(parts[1].end <= 5.3, 'se recorta el silencio de cierre');
  assert.equal(planSilenceParts([word(1, 1.4, 'solo')], clip).length, 1);
  assert.equal(planSilenceParts(words, clip, { threshold: 5 }).length, 1, 'con un umbral alto no corta');
});

test('planColdOpen solo adelanta un pico lejano y la línea de tiempo lo coloca delante', () => {
  const transcript = { segments: [
    { id: 1, start: 10, end: 14, text: 'inicio lento', words: [word(10, 11, 'inicio'), word(11, 12, 'lento')] },
    { id: 2, start: 20, end: 24, text: 'pico explosivo', words: [word(20.2, 20.8, 'pico'), word(20.8, 21.4, 'explosivo'), word(21.4, 22, 'ahora'), word(22, 24, 'mismo')] },
  ] };
  const clip = { start: 10, end: 30 };
  assert.equal(planColdOpen(clip, transcript, 1), null, 'el pico ya está al inicio');
  assert.equal(planColdOpen(clip, transcript, 99), null);
  const cold = planColdOpen(clip, transcript, 2);
  assert.ok(cold.start >= 20 && cold.end - cold.start >= 0.8 && cold.end - cold.start <= 2.1);
  const timeline = buildTimeline(clip, [{ start: 10, end: 30 }], cold);
  assert.equal(timeline.parts[0].cold, true);
  assert.equal(timeline.parts[1].outStart, timeline.parts[0].duration);
  assert.ok(Math.abs(timeline.total - (cold.end - cold.start + 20)) < 0.1);
  assert.equal(timelineChangesClip(timeline), true);
  assert.equal(mapTime(timeline, 21), timeline.parts[1].outStart + 11, 'prefiere el tramo principal');
  assert.equal(timelineChangesClip(buildTimeline(clip, [{ start: 10, end: 29.9 }])), false, 'un recorte mínimo no justifica montar');
});

test('timelineCues desplaza los subtítulos a la posición del montaje', () => {
  const timeline = buildTimeline({ start: 0, end: 10 }, [{ start: 0, end: 3 }, { start: 6, end: 9 }]);
  const cues = timelineCues(timeline, (range) => [{ start: 0.5, end: 1.5, text: `t${range.start}`, tokens: [{ start: 0.5, end: 1.5, text: 'x' }] }]);
  assert.deepEqual(cues.map(({ start }) => start), [0.5, 3.5]);
  assert.equal(cues[1].tokens[0].start, 3.5);
});

test('punchTimes respeta energía, separación y máximo; punchFilter genera zoom y temblor', () => {
  const clip = { start: 10, end: 40 };
  const segments = [
    { start: 10.2, energy: 10 }, { start: 12, energy: 9 }, { start: 13, energy: 8 }, { start: 17, energy: 8 },
    { start: 21.5, energy: 7 }, { start: 25, energy: 9 }, { start: 39.8, energy: 10 },
  ];
  const times = punchTimes(segments, clip);
  assert.deepEqual(times, [12, 17, 25], 'sin el arranque, sin el final, separados al menos 4 s y con energía >= 8');
  assert.deepEqual(punchTimes(segments, clip, { max: 1 }), [12]);
  assert.equal(punchFilter([], 1080, 1920), '');
  const filter = punchFilter([2, 9], 1080, 1920);
  assert.match(filter, /eval=frame/);
  assert.match(filter, /between\(t,2\.000,2\.220\)\*8\*sin\(t\*95\)/);
  assert.match(filter, /crop=1080:1920/);
});

test('trimGraph y retarget montan el recorte y la unión de tramos', () => {
  const timeline = buildTimeline({ start: 10, end: 20 }, [{ start: 10, end: 13 }, { start: 15, end: 20 }], { start: 17, end: 18.6 });
  const graph = trimGraph(timeline, 10);
  assert.match(graph.video, /split=3/);
  assert.match(graph.video, /concat=n=3:v=1:a=0\[vcut\]/);
  assert.match(graph.video, /trim=start=7\.000:end=8\.600/);
  assert.match(graph.audio, /concat=n=3:v=0:a=1\[voice0\]/);
  assert.equal(retarget('[0:v]scale=10:10'), '[vcut]scale=10:10');
  assert.equal(retarget('otra cosa'), 'otra cosa');
});

test('el prompt y el esquema piden el pico, las palabras clave y el potencial de bucle', () => {
  assert.match(editorSystem, /18–32 segundos/);
  assert.match(editorSystem, /peakSegmentId/);
  assert.match(editorSystem, /highlightWords/);
  assert.match(editorSystem, /loopScore/);
  assert.match(reviewSystem, /loopScore/);
  const properties = editorSchema.properties.clips.items.properties;
  assert.ok(properties.peakSegmentId && properties.hasColdOpenHook && properties.highlightWords && properties.loopScore);
  assert.ok(!editorSchema.properties.clips.items.required.includes('loopScore'), 'son opcionales: un motor que no los devuelva sigue funcionando');
});

test('chooseClips conserva pico, palabras clave y bucle y descarta valores fuera de rango', async () => {
  const segments = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, start: index * 5, end: index * 5 + 4.5, text: `Frase ${index + 1} con contenido de sobra para el análisis.`, energy: 6, wps: 2, pauseBefore: 0 }));
  const infer = async ({ schema }) => {
    if (schema.properties.clips) {
      return { clips: [{
        startSegmentId: 1, endSegmentId: 6, title: 'Un momento brutal', onScreenHook: 'El giro del final', category: 'humor', reason: 'Tensión constante.',
        hookScore: 9, retentionScore: 9, shareScore: 9, clarityScore: 9, score: 9,
        peakSegmentId: 4, hasColdOpenHook: true, highlightWords: ['brutal', ' ', 'x'.repeat(40), 'giro'], loopScore: 8,
      }, {
        startSegmentId: 1, endSegmentId: 6, title: 'Otro momento distinto', onScreenHook: 'Todo cambia ahora', category: 'humor', reason: 'Otra razón.',
        hookScore: 9, retentionScore: 9, shareScore: 9, clarityScore: 9, score: 9, peakSegmentId: 99, hasColdOpenHook: true, loopScore: 40,
      }] };
    }
    return { selected: [1, 2] };
  };
  const result = await chooseClips(infer, { language: 'es', segments }, { duration: 40 }, async () => {});
  const first = result.find(({ title }) => title === 'Un momento brutal');
  assert.equal(first.peakSegmentId, 4);
  assert.equal(first.hasColdOpenHook, true);
  assert.deepEqual(first.highlightWords, ['brutal', 'giro']);
  assert.equal(first.loopScore, 8);
  const second = result.find(({ title }) => title === 'Otro momento distinto');
  if (second) {
    assert.equal(second.peakSegmentId, undefined, 'un pico fuera del clip se descarta');
    assert.equal(second.hasColdOpenHook, undefined);
    assert.equal(second.loopScore, undefined);
  }
});

test('renderClip monta cortes de silencio, cold open, zoom, estilo hormozi-pop y deja el sonido en objetivo', async (t) => {
  await mkdir(dataDir, { recursive: true });
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=16', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=16',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const make = (id, start, texts) => {
    const words = texts.map((text, index) => word(start + index * 0.5, start + index * 0.5 + 0.45, text));
    return { id, start, end: words.at(-1).end, text: texts.join(' '), words, energy: 9, wps: 2, pauseBefore: 0 };
  };
  const segments = [make(1, 1, ['Esto', 'es', 'lento']), make(2, 5, ['Ahora', 'viene', 'lo', 'mejor']), make(3, 10, ['Increíble', 'pico', 'final'])];
  const transcript = { language: 'es', segments };
  const clip = { file: 'clip-1.mp4', title: 'Prueba', start: 0.8, end: 13, onScreenHook: 'Algo pasa', hasColdOpenHook: true, peakSegmentId: 3, highlightWords: ['pico'] };
  const brand = normalizeBrand({ id: 'pop', name: 'Pop', handle: '@pop', showWatermark: false, subtitlePreset: 'hormozi-pop', accentHex: '#00FF88' });
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });
  const plan = { layout: 'fit', mode: 'fit', tracks: [[]], regions: [] };

  const baseline = await renderClip(source, directory, { ...clip, hasColdOpenHook: false }, transcript, plan, 1, format, { aspect: 16 / 9, brand, jumpCuts: false, punch: false });
  const baselineDuration = (await probeVideo(join(directory, baseline))).duration;
  assert.ok(Math.abs(baselineDuration - 12.2) < 0.4, `sin montaje dura lo mismo que el original (${baselineDuration})`);

  const file = await renderClip(source, directory, clip, transcript, plan, 2, format, { aspect: 16 / 9, brand, audioSegments: segments });
  const media = await probeVideo(join(directory, file));
  assert.ok(media.audio);
  assert.ok(media.duration < baselineDuration + 1.7 - 2, `los silencios largos se quitan aunque se añada el adelanto (${media.duration} vs ${baselineDuration})`);
  assert.ok(media.duration > 5, 'queda contenido');

  const ass = await readFile(join(directory, 'clip-2.ass'), 'utf8');
  assert.match(ass, /\\t\(0,75,\\fscx112\\fscy112\)\\t\(75,160,\\fscx100\\fscy100\)/, 'pop elástico de hormozi-pop');
  assert.match(ass, /ESTO|AHORA|INCRE/, 'mayúsculas');
  assert.match(ass, /\{\\c&H0088FF00&\}PICO\{\\r\}|\\c&H0088FF00&\\fscx92/, 'acento de la marca en la palabra clave');
  const firstDialogue = [...ass.matchAll(/Dialogue: 0,(\d+):(\d+):([\d.]+)/g)].map(([, h, m, s]) => Number(h) * 3600 + Number(m) * 60 + Number(s));
  assert.ok(firstDialogue.every((time) => time <= media.duration + 0.05), 'ningún subtítulo se sale del montaje');

  const loudness = await measureLoudness(join(directory, file));
  assert.ok(loudness && loudness.lufs > -20 && loudness.lufs < -12, `sonoridad ${loudness?.lufs}`);
});
