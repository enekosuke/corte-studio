import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildAudioGraph, censorText, isProfane, pickBgm, planSfxEvents, profanityRanges, sfxNames, sfxPath } from '../pipeline/audio.mjs';
import { normalizeBrand } from '../pipeline/brands.mjs';
import { buildTimeline, isFiller, phraseBoundaries, planSilenceParts, punchFilter } from '../pipeline/clipfx.mjs';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { dataDir, getMediaTools, measureLoudness, probeVideo, renderClip } from '../pipeline/media.mjs';
import { generateSfx, sfxRecipes } from '../scripts/generate-sfx.mjs';

const word = (start, end, text) => ({ start, end, text });

test('la biblioteca incluye los 6 efectos y se puede regenerar', async (t) => {
  const { stat } = await import('node:fs/promises');
  for (const name of sfxNames) assert.ok((await stat(sfxPath(name))).size > 1000, `${name}.ogg existe`);
  assert.deepEqual(Object.keys(sfxRecipes).sort(), [...sfxNames].sort());
  const temp = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const files = await generateSfx(temp);
  assert.equal(files.length, 6);
  for (const file of files) assert.ok((await stat(file)).size > 1000);
});

test('detección y censura de palabrotas en español sin falsos positivos habituales', () => {
  for (const text of ['joder', '¡Mierda!', 'coño', 'hostia', 'putada', 'cabrón', 'gilipollas', 'culo']) assert.equal(isProfane(text), true, text);
  for (const text of ['cono', 'computadora', 'disputa', 'pollo', 'Hola', 'jugar', 'hostal', 'ok']) assert.equal(isProfane(text), false, text);
  assert.equal(censorText('Joder, qué mierda de cono'), 'J***r, qué m****a de cono');
});

test('profanityRanges coloca los pitidos sobre el montaje y fusiona los cercanos', () => {
  const words = [word(1, 1.3, 'hola'), word(2, 2.4, 'joder'), word(2.45, 2.8, 'mierda'), word(5, 5.4, 'hostia')];
  const direct = profanityRanges(words, { start: 0.5, end: 8 });
  assert.equal(direct.length, 2, 'los dos primeros se fusionan');
  assert.ok(direct[0].start < 1.5 && direct[0].end > 2.3);
  const timeline = buildTimeline({ start: 0.5, end: 8 }, [{ start: 0.5, end: 3 }, { start: 4.8, end: 8 }]);
  const mapped = profanityRanges(words, { start: 0.5, end: 8 }, timeline);
  assert.ok(mapped[1].start < direct[1].start, 'tras recortar el hueco, la palabrota llega antes');
  assert.deepEqual(profanityRanges([word(9, 9.4, 'joder')], { start: 0.5, end: 8 }), []);
});

test('muletillas: se detectan los sonidos de duda y se cortan como si fueran silencios', () => {
  assert.equal(isFiller(word(0, 0.3, 'eeeh')), true);
  assert.equal(isFiller(word(0, 0.3, 'mmm')), true);
  assert.equal(isFiller(word(0, 0.3, 'hola')), false);
  assert.equal(isFiller(word(0, 0.3, 'Bueno,'), word(0.7, 1, 'vamos')), true, 'arranque vacío seguido de pausa');
  assert.equal(isFiller(word(0, 0.3, 'bueno'), word(0.35, 1, 'vamos')), false, 'sin pausa es una palabra normal');
  const words = [word(1, 1.4, 'esto'), word(1.45, 1.8, 'eeeh'), word(1.85, 2.3, 'cambia'), word(2.4, 2.9, 'todo')];
  const clip = { start: 0.9, end: 3.4 };
  assert.equal(planSilenceParts(words, clip, { fillers: false }).length, 1, 'sin filtro de muletillas no corta');
  const parts = planSilenceParts(words, clip);
  assert.equal(parts.length, 2, 'la muletilla genera un corte');
  assert.ok(parts[0].end < 1.6 && parts[1].start > 1.75, 'el corte deja fuera "eeeh"');
});

test('zoom: alterna plano en cada frase y añade el adelanto con color y oscurecimiento final', () => {
  const transcript = { segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4.5, end: 5 }, { start: 8, end: 9 }, { start: 30, end: 31 }] };
  const clip = { start: 0, end: 12 };
  assert.deepEqual(phraseBoundaries(transcript, clip), [1, 4.5, 8], 'separadas al menos 3 s y dentro del clip');
  const filter = punchFilter([2.5], 1080, 1920, { alternate: [1, 4.5], cold: 1.6 });
  assert.match(filter, /gte\(t,1\.000\)\*\(1-exp/);
  assert.match(filter, /-0\.09\*gte\(t,4\.500\)/, 'la segunda frase vuelve al plano medio');
  assert.match(filter, /0\.1\*lt\(t,1\.600\)/, 'zoom del adelanto');
  assert.match(filter, /eq=contrast='1\+0\.12\*lt\(t,1\.600\)'.*brightness='-clip\(\(t-1\.450\)\/0\.15,0,1\)\*lt\(t,1\.600\)'/);
  assert.match(punchFilter([], 1080, 1920, { alternate: [2] }), /crop=1080:1920:x='\(in_w-1080\)\/2\+0'/);
  assert.equal(punchFilter([], 1080, 1920), '');
});

test('planSfxEvents y buildAudioGraph componen censura, música con ducking, efectos y sonoridad', async (t) => {
  assert.deepEqual(planSfxEvents({ hasHook: true, cold: false, punches: [3, 6, 9, 12] }).map(({ name }) => name), ['whoosh', 'pop', 'hit', 'hit', 'hit']);
  assert.equal(planSfxEvents({ cold: true })[0].volume, 0.7);
  const { graph, inputs, usedInputs } = buildAudioGraph({
    duration: 20, bleeps: [{ start: 2, end: 2.4 }], climaxAt: 12, bgm: { path: 'musica.ogg', volumeDb: -18 },
    sfx: [{ name: 'whoosh', at: 0, volume: 0.5 }, { name: 'pop', at: 0.08, volume: 0.4 }],
  });
  assert.deepEqual(inputs.slice(0, 3), ['-stream_loop', '-1', '-i']);
  assert.equal(inputs.filter((entry) => entry === '-i').length, 3);
  assert.equal(usedInputs, 3);
  assert.match(graph, /volume='1-gt\(between\(t,2\.000,2\.400\),0\)':eval=frame/);
  assert.match(graph, /aevalsrc='0\.3\*sin\(2\*PI\*1000\*t\)/);
  assert.match(graph, /sidechaincompress=threshold=0\.03:ratio=6:attack=40:release=350/);
  assert.match(graph, /volume='1-between\(t,11\.650,12\.000\)':eval=frame/, 'silencio de 0,35 s antes del clímax');
  assert.match(graph, /highpass=f=80,volume=-18dB/);
  assert.match(graph, /adelay=80\|80/);
  assert.match(graph, /\[with_sfx\]loudnorm=I=-16:TP=-1\.5:LRA=11\[aout\]/);
  assert.equal(buildAudioGraph({ duration: 5 }).graph, '[voice0]loudnorm=I=-16:TP=-1.5:LRA=11[aout]');

  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'bgm'));
  await writeFile(join(directory, 'bgm', 'b.mp3'), 'x');
  await writeFile(join(directory, 'bgm', 'a.ogg'), 'x');
  await writeFile(join(directory, 'bgm', 'notas.txt'), 'x');
  const relative = join('.corte-data', directory.split(/[\\/]/).at(-1), 'bgm');
  assert.equal((await pickBgm({ bgmFolder: relative, bgmVolumeDb: -20 }, 1)).path.endsWith('a.ogg'), true);
  assert.equal((await pickBgm({ bgmFolder: relative }, 2)).path.endsWith('b.mp3'), true);
  assert.equal((await pickBgm({ bgmFolder: relative }, 3)).path.endsWith('a.ogg'), true, 'rota entre pistas');
  assert.equal(await pickBgm({ bgmFolder: '' }, 1), null);
});

test('renderClip aplica censura, muletillas, música con ducking, efectos y adelanto con sonido en objetivo', async (t) => {
  await mkdir(dataDir, { recursive: true });
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=20',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  await mkdir(join(directory, 'bgm'));
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=5', '-c:a', 'libvorbis', join(directory, 'bgm', 'fondo.ogg')]);
  const make = (id, start, texts) => {
    const words = texts.map((text, index) => word(start + index * 0.5, start + index * 0.5 + 0.45, text));
    return { id, start, end: words.at(-1).end, text: texts.join(' '), words, energy: 9, wps: 2, pauseBefore: 0 };
  };
  const segments = [make(1, 1, ['Esto', 'es', 'una', 'mierda']), make(2, 4, ['eeeh', 'ahora', 'viene', 'lo', 'mejor']), make(3, 13, ['Increíble', 'pico', 'final'])];
  const transcript = { language: 'es', segments };
  const clip = { file: 'clip-1.mp4', title: 'Prueba', start: 0.8, end: 16, onScreenHook: 'Algo pasa', hasColdOpenHook: true, peakSegmentId: 3 };
  const relative = join('.corte-data', directory.split(/[\\/]/).at(-1), 'bgm');
  const brand = normalizeBrand({ id: 'pop', name: 'Pop', handle: '@pop', showWatermark: true, subtitlePreset: 'hormozi-pop', bgmFolder: relative, bgmVolumeDb: -22 });
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });
  const plan = { layout: 'fit', mode: 'fit', tracks: [[]], regions: [] };
  const file = await renderClip(source, directory, clip, transcript, plan, 1, format, { aspect: 16 / 9, brand, audioSegments: segments });
  const media = await probeVideo(join(directory, file));
  assert.ok(media.audio && media.duration > 4 && media.duration < 14, `duración ${media.duration}`);
  const ass = await readFile(join(directory, 'clip-1.ass'), 'utf8');
  assert.match(ass, /M\*\*\*\*A/, 'subtítulo censurado y en mayúsculas');
  assert.doesNotMatch(ass, /MIERDA/);
  assert.doesNotMatch(ass, /EEEH/, 'la muletilla no aparece en los subtítulos');
  const loudness = await measureLoudness(join(directory, file));
  assert.ok(loudness && loudness.lufs > -20 && loudness.lufs < -12, `sonoridad ${loudness?.lufs}`);

  const quiet = await renderClip(source, directory, clip, transcript, plan, 2, format, { aspect: 16 / 9, brand: { ...brand, bgmFolder: '', bleepProfanity: false, sfx: false }, audioSegments: segments });
  const quietAss = await readFile(join(directory, 'clip-2.ass'), 'utf8');
  assert.match(quietAss, /MIERDA/, 'sin censura el subtítulo es literal');
  assert.ok((await probeVideo(join(directory, quiet))).audio);
});
