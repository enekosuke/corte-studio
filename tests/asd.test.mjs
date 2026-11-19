import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chooseClips } from '../pipeline/analysis.mjs';
import { ASD, decideSpeakers, refineSpeakerFraming, speakerTrack } from '../pipeline/asd.mjs';
import { normalizeFormat } from '../pipeline/formats.mjs';
import { auditClip, dataDir, fetchChatSpikes, getMediaTools } from '../pipeline/media.mjs';
import { pythonOrDefault } from '../pipeline/runtime.mjs';
import { normalizeBeats } from '../pipeline/summary.mjs';

const python = await pythonOrDefault();
const visionTools = join(dataDir, 'vision-tools');
const pythonEnv = { ...process.env, PYTHONUTF8: '1', PYTHONPATH: [visionTools, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
const script = (name) => fileURLToPath(new URL(`../pipeline/${name}`, import.meta.url));
const example = fileURLToPath(new URL('../dist/assets/podcast.png', import.meta.url));
const word = (start, end, text = 'x') => ({ start, end, text });

// Dos copias (una reflejada) de la foto de ejemplo con movimiento en la boca de la izquierda 2 s y de la derecha 2 s.
const framesProgram = `
import cv2, numpy as np, os, sys
out = sys.argv[1]
img = cv2.imread(sys.argv[2])
two = np.hstack([img, cv2.flip(img, 1)])
two = cv2.resize(two, (960, int(960 * two.shape[0] / two.shape[1])))
gray = cv2.cvtColor(two, cv2.COLOR_BGR2GRAY)
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
faces = sorted(cascade.detectMultiScale(gray, 1.1, 5, minSize=(40, 40)).tolist(), key=lambda f: f[0])
assert len(faces) == 2, faces
rng = np.random.default_rng(7)
for i in range(24):
    frame = two.copy()
    x, y, w, h = faces[0] if i < 12 else faces[1]
    x0, x1, y0, y1 = int(x + w * 0.2), int(x + w * 0.8), int(y + h * 0.58), int(y + h * 0.98)
    frame[y0:y1, x0:x1] = rng.integers(0, 255, (y1 - y0, x1 - x0, 3), dtype=np.uint8)
    cv2.imwrite(os.path.join(out, 'f%04d.jpg' % (i + 1)), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
`;

test('active_speaker.py detecta dos personas fijas y puntúa quién mueve la boca en cada ventana', async (t) => {
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync(python, ['-c', framesProgram, directory, example], { env: pythonEnv });
  const analysis = JSON.parse(execFileSync(python, [script('active_speaker.py'), directory, '--fps', '6', '--window', '0.5'], { env: pythonEnv, encoding: 'utf8' }));
  assert.equal(analysis.slots.length, 2);
  assert.ok(analysis.slots[0].x < analysis.slots[1].x);
  const early = analysis.windows.filter(({ t: at }) => at >= 0.5 && at < 1.9);
  const late = analysis.windows.filter(({ t: at }) => at >= 2.5 && at < 3.9);
  assert.ok(early.length && late.length);
  for (const { scores } of early) assert.ok(scores[0] > scores[1] * 1.6, `izquierda domina al principio ${scores}`);
  for (const { scores } of late) assert.ok(scores[1] > scores[0] * 1.6, `derecha domina al final ${scores}`);

  const decision = decideSpeakers(analysis, [word(0, 4)], { start: 0, end: 4 });
  assert.deepEqual(decision.segments.map(({ speaker }) => speaker), [0, 1]);
  const track = speakerTrack(decision, analysis);
  assert.equal(track.length, 2);
  assert.equal(track[0].cutBefore, false);
  assert.equal(track[1].cutBefore, true, 'el cambio de hablante es un corte limpio');
  assert.ok(track[0].x < 0.5 && track[1].x > 0.5);
  assert.equal(track[0].offset, 0);
});

test('un vídeo con una sola persona no genera puestos', async (t) => {
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ffmpeg } = await getMediaTools();
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-loop', '1', '-framerate', '6', '-t', '2', '-i', example, '-vf', 'scale=640:-2', join(directory, 'f%04d.jpg')]);
  const analysis = JSON.parse(execFileSync(python, [script('active_speaker.py'), directory], { env: pythonEnv, encoding: 'utf8' }));
  assert.ok(analysis.slots.length < 2);
  assert.deepEqual(analysis.windows, []);
});

const analysisOf = (rows) => ({ window: 0.5, slots: [{ x: 0.2, y: 0.3, w: 0.15, h: 0.3 }, { x: 0.65, y: 0.3, w: 0.15, h: 0.3 }], windows: rows.map(([t, a, b]) => ({ t, scores: [a, b] })) });

test('decideSpeakers: dominancia, solape, silencio y planos mínimos', () => {
  const loud = 0.03;
  const quiet = 0.001;
  const rows = [[0, loud, quiet], [0.5, loud, quiet], [1, loud, quiet], [1.5, quiet, loud], [2, quiet, loud], [2.5, quiet, loud], [3, quiet, loud], [3.5, quiet, loud]];
  const clip = { start: 0, end: 4 };
  const decision = decideSpeakers(analysisOf(rows), [word(0, 4)], clip);
  assert.deepEqual(decision.segments.map(({ speaker, start, end }) => [speaker, start, end]), [[0, 0, 1.5], [1, 1.5, 4]]);
  assert.equal(decision.switches, 1);
  assert.equal(decision.overlapFraction, 0);

  const overlap = decideSpeakers(analysisOf(rows.map(([t]) => [t, loud, loud * 0.9])), [word(0, 4)], clip);
  assert.equal(overlap.overlapFraction, 1);
  assert.deepEqual(overlap.segments.map(({ speaker }) => speaker), ['both']);

  const silent = decideSpeakers(analysisOf(rows), [], clip);
  assert.deepEqual(silent.segments, [], 'sin voz nadie habla');

  const gap = decideSpeakers(analysisOf([[0, loud, quiet], [0.5, loud, quiet], [1, loud, quiet], [1.5, loud, quiet], [2, quiet, loud], [2.5, loud, quiet], [3, loud, quiet], [3.5, loud, quiet]]), [word(0, 4)], clip);
  assert.deepEqual(gap.segments.map(({ speaker }) => speaker), [0], 'un plano de 0,5 s no se mantiene');
  assert.ok(ASD.minHold >= 1.5);
});

test('refineSpeakerFraming corta al que habla, respeta el solape y no toca otros encuadres', async () => {
  const faces = [{ left: 0.15, right: 0.3, top: 0.2, bottom: 0.5 }, { left: 0.65, right: 0.8, top: 0.2, bottom: 0.5 }];
  const sceneData = { frames: [{ faces }, { faces }, { faces }, { faces }] };
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fill', 'split'], fitCrop: 'original' });
  const base = { clip: { start: 0, end: 4 }, clipNumber: 1, sceneData, transcript: { segments: [{ start: 0, end: 4, text: 'hablan', words: [word(0, 4)] }] }, format, media: { aspect: 16 / 9 }, source: 'x', directory: 'y' };
  const loud = 0.03;
  const rows = [[0, loud, 0.001], [0.5, loud, 0.001], [1, loud, 0.001], [1.5, 0.001, loud], [2, 0.001, loud], [2.5, 0.001, loud], [3, 0.001, loud], [3.5, 0.001, loud]];
  const split = { layout: 'split', tracks: [[], []] };
  const refined = await refineSpeakerFraming({ ...base, framing: split, analyze: async () => analysisOf(rows) });
  assert.equal(refined.layout, 'fill');
  assert.equal(refined.tracks[0].length, 2);
  assert.equal(refined.tracks[0][1].cutBefore, true);
  assert.equal(refined.activeSpeaker.switches, 1);
  assert.match(refined.reason, /Hablante activo/);
  assert.ok(refined.boxes.length >= 1);

  const talkOver = await refineSpeakerFraming({ ...base, framing: split, analyze: async () => analysisOf(rows.map(([t]) => [t, loud, loud * 0.95])) });
  assert.equal(talkOver, split, 'con solape se conserva la pantalla dividida');
  const gameplay = { layout: 'gameplay' };
  assert.equal(await refineSpeakerFraming({ ...base, framing: gameplay, analyze: async () => assert.fail('no debe analizar') }), gameplay);
  const oneFace = { frames: [{ faces: [faces[0]] }, { faces: [faces[0]] }] };
  assert.equal((await refineSpeakerFraming({ ...base, sceneData: oneFace, framing: split, analyze: async () => assert.fail('una persona no se analiza') })), split);
  assert.equal(await refineSpeakerFraming({ ...base, framing: split, analyze: async () => null }), split, 'si el análisis falla se queda como estaba');
  const noFill = normalizeFormat({ ratio: '9:16', layouts: ['split'], fitCrop: 'original' });
  assert.equal(await refineSpeakerFraming({ ...base, format: noFill, framing: split, analyze: async () => assert.fail('sin fill no hay corte') }), split);
});

const chatLine = (ms, kind = 'addChatItemAction') => JSON.stringify({ replayChatItemAction: { actions: [{ [kind]: { item: {} } }], videoOffsetTimeMsec: String(ms) }, videoOffsetTimeMsec: String(ms) });

test('chat_peaks.py puntúa las ventanas de 10 s y anota chatSpike en la transcripción', async (t) => {
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lines = [];
  for (let second = 0; second < 300; second += 2) lines.push(chatLine(second * 1000));
  for (let index = 0; index < 120; index++) lines.push(chatLine(100_000 + index * 80));
  lines.push(chatLine(50_000, 'removeChatItemAction'), 'no es json', '');
  await writeFile(join(directory, 'chat.live_chat.json'), lines.join('\n'));
  const transcript = { language: 'es', segments: [{ id: 1, start: 10, end: 14, text: 'normal' }, { id: 2, start: 101, end: 108, text: 'pico' }, { id: 3, start: 200, end: 205, text: 'normal' }] };
  await writeFile(join(directory, 'transcript.json'), JSON.stringify(transcript));
  const result = JSON.parse(execFileSync(python, [script('chat_peaks.py'), join(directory, 'chat.live_chat.json'), join(directory, 'transcript.json')], { encoding: 'utf8' }));
  assert.equal(result.messages, 270);
  assert.equal(result.annotated, 3);
  assert.equal(result.peak, 10);
  const annotated = JSON.parse(await readFile(join(directory, 'transcript.json'), 'utf8'));
  assert.equal(annotated.segments[1].chatSpike, 10);
  assert.equal(annotated.segments[0].chatSpike, 1);
  assert.equal(annotated.segments[2].chatSpike, 1);
});

test('un chat casi vacío no anota nada y fetchChatSpikes reutiliza su resultado guardado', async (t) => {
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'chat.live_chat.json'), [chatLine(1000), chatLine(2000)].join('\n'));
  await writeFile(join(directory, 'transcript.json'), JSON.stringify({ segments: [{ start: 0, end: 5, text: 'x' }] }));
  const result = JSON.parse(execFileSync(python, [script('chat_peaks.py'), join(directory, 'chat.live_chat.json'), join(directory, 'transcript.json')], { encoding: 'utf8' }));
  assert.equal(result.annotated, 0);
  assert.equal(JSON.parse(await readFile(join(directory, 'transcript.json'), 'utf8')).segments[0].chatSpike, undefined);
  await writeFile(join(directory, 'chat-peaks.json'), JSON.stringify({ available: true, messages: 99, annotated: 7, peak: 9 }));
  assert.deepEqual(await fetchChatSpikes('https://www.youtube.com/watch?v=aaaaaaaaaaa', directory), { available: true, messages: 99, annotated: 7, peak: 9 });
});

test('chatSpike llega al motor y sube el valor de un pasaje del resumen', async () => {
  const segments = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, start: index * 5, end: index * 5 + 4.5, text: `Frase ${index + 1} con contenido suficiente.`, energy: 3, wps: 2, pauseBefore: 0, ...(index === 3 ? { chatSpike: 9 } : {}) }));
  let sent;
  await chooseClips(async ({ schema, parts }) => {
    if (schema.properties.clips) sent = JSON.parse(parts[0].text);
    return schema.properties.clips ? { clips: [] } : { selected: [] };
  }, { language: 'es', segments }, { duration: 40 }, async () => {});
  assert.equal(sent.segments.find(({ id }) => id === 4).chatSpike, 9);
  assert.equal(sent.segments.find(({ id }) => id === 1).chatSpike, undefined);

  const index = new Map(segments.map((segment, position) => [segment.id, position]));
  const raw = (startSegmentId, endSegmentId) => ({ startSegmentId, endSegmentId, importance: 6, appeal: 5, kind: 'historia', topic: 't', summary: 's' });
  const [calm] = normalizeBeats([raw(1, 2)], segments, index, 40);
  const [hype] = normalizeBeats([raw(3, 5)], segments, index, 40);
  assert.ok(hype.value > calm.value, `el chat sube el valor (${hype.value} vs ${calm.value})`);
});

test('auditClip comprueba sonoridad, fotogramas, audio y zona segura de subtítulos', async (t) => {
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ffmpeg } = await getMediaTools();
  const make = (name, video, audioFilter) => {
    const file = join(directory, name);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', audioFilter, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', file]);
    return file;
  };
  const style = (margin) => `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Corte,Arial Black,72,&H00FFFFFF,&H00FFFFFF,&H0008080F,&HB0000000,-1,0,0,0,100,100,0,0,1,7,3,2,90,90,${margin},1\n`;
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });

  const good = make('bien.mp4', 'testsrc=s=640x360:r=30:d=4', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  await writeFile(join(directory, 'bien.ass'), style(310));
  const ok = await auditClip(good, { assPath: join(directory, 'bien.ass'), format });
  assert.equal(ok.ok, true, ok.issues.join('; '));
  assert.equal(ok.frames.length, 3);
  assert.ok(ok.lufs > -16.5 && ok.lufs < -13.5);

  const bad = make('mal.mp4', 'color=black:s=640x360:r=30:d=4', 'volume=-30dB');
  await writeFile(join(directory, 'mal.ass'), style(60));
  const failed = await auditClip(bad, { assPath: join(directory, 'mal.ass'), format });
  assert.equal(failed.ok, false);
  assert.ok(failed.issues.some((issue) => /sonoridad/.test(issue)), failed.issues.join('; '));
  assert.ok(failed.issues.some((issue) => /negro/.test(issue)));
  assert.ok(failed.issues.some((issue) => /zona de botones/.test(issue)));
  assert.equal((await auditClip(join(directory, 'no-existe.mp4'))).ok, false);
});
