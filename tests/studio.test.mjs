import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import youtubeMod from '../dist/youtube.js';
import { buildAgentCandidates, buildAgentFramingPlan, chooseClips, chooseFraming, choosePrototypeFraming, cvFramingPlan, inspectInset, refineGameplayHook, refineInsetPlan, refinePrototypeCopy } from '../pipeline/analysis.mjs';
import { compositionGraph, containOffsetY, defaultFormat, layoutPanels, normalizeFormat, outputSize } from '../pipeline/formats.mjs';
import { resolvePython } from '../pipeline/runtime.mjs';
import { cancelAllJobs, getJob, jobsDir, processVideo, resumeJob, saveJobRecord, subscribeJobEvents } from '../pipeline/jobs.mjs';
import { analyzeAudioSignals, dataDir, getMediaTools, listVoiceModels, probeVideo, renderClip, renderPrototypeClip } from '../pipeline/media.mjs';
import { analyzeAndSaveClipSeo, generatePublicationSuggestions, loadPublication, saveAgentSeoSuggestion, savePublicationDraft } from '../pipeline/publication.mjs';
import { buildVideoMetadata, getLatestScheduledUpload, nextPublishDate, uploadSingleClip } from '../pipeline/youtube_upload.mjs';

async function workspace(t) {
  await mkdir(dataDir, { recursive: true });
  const dir = await mkdtemp(join(dataDir, 'verify-'));
  t.after(async () => {
    for (const file of await readdir(dir)) await rm(join(dir, file));
    await rmdir(dir);
  });
  return dir;
}

const clip = { file: 'clip-1.mp4', title: 'Corte de prueba', start: 0, end: 2.2 };
const transcript = { segments: [{ start: 0.2, end: 1.6, text: 'Así se conserva el subtítulo.' }] };

test('buscar más clips vuelve a selección, excluye los tramos usados y añade al mismo proyecto', async (t) => {
  const id = randomUUID();
  const directory = join(jobsDir, id);
  await mkdir(directory, { recursive: true });
  t.after(async () => {
    const job = await getJob(id);
    if (job && !['done', 'error'].includes(job.stage)) await cancelAllJobs();
    for (const file of await readdir(directory)) await rm(join(directory, file));
    await rmdir(directory);
  });
  const { ffmpeg } = await getMediaTools();
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-c:v', 'libx264', '-c:a', 'aac', join(directory, 'source.mp4')]);
  const old = { file: 'clip-3.mp4', start: 0, end: 8, title: 'Primer corte' };
  await writeFile(join(directory, old.file), 'archivo anterior');
  await writeFile(join(directory, 'youtube-uploads.json'), '{"clip-3.mp4":{"videoId":"ya-publicado"}}');
  await writeFile(join(directory, 'candidates.json'), JSON.stringify([old]));
  await writeFile(join(directory, 'transcript.json'), JSON.stringify({ language: 'es', segments: [
    { id: 1, start: 0, end: 8, text: 'Fragmento que ya se publicó.' },
    { id: 2, start: 7.9, end: 9.5, text: 'Transición que toca el corte existente.' },
    { id: 3, start: 10, end: 22, text: 'Ahora sí aparece un momento que no habíamos exportado.' },
  ] }));
  await saveJobRecord({ id, videoId: 'abcdefghijk', title: 'Willyrex en GTA V', sourceChannel: 'Willyrex', provider: 'gemini',
    stage: 'done', mode: 'normal', clips: [old], format });
  const engine = { provider: 'gemini', key: 'fake' };
  let selections = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    let value = { ideas: [] };
    if (request.generationConfig.responseJsonSchema.properties.clips) {
      selections++;
      const input = JSON.parse(request.contents[0].parts[0].text);
      assert.deepEqual(input.segments.map(({ id }) => id), [3]);
      assert.equal(input.sourceChannel, 'Willyrex');
      value = { clips: [{ startSegmentId: 3, endSegmentId: 3, title: 'Otro momento',
        onScreenHook: 'El giro del final', reason: 'Una reacción nueva.', score: 9, category: 'reaccion' }] };
    } else if (request.generationConfig.responseJsonSchema.properties.onScreenHook) {
      assert.ok(request.contents[0].parts.some((part) => part.inline_data?.mime_type === 'image/jpeg'));
      assert.equal(JSON.parse(request.contents[0].parts[0].text).sourceChannel, 'Willyrex');
      value = { onScreenHook: 'A Willyrex le cortan la retirada' };
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
  });
  const finishSearch = async () => {
    let unsubscribe;
    const finished = new Promise((resolve) => {
      unsubscribe = subscribeJobEvents((job) => {
        if (job.id === id && ['done', 'error'].includes(job.stage)) resolve(job);
      });
    });
    try {
      const started = await resumeJob(id, engine, { searchMore: true });
      assert.equal(started.id, id);
      assert.equal(started.stage, 'selecting');
      return await Promise.race([finished, new Promise((_, reject) =>
        setTimeout(() => reject(new Error('El trabajo de prueba no terminó.')), 150000).unref())]);
    } finally { unsubscribe(); }
  };
  const completed = await finishSearch();
  assert.equal(completed.stage, 'done', completed.message);
  assert.deepEqual(completed.clips.map(({ file }) => file), ['clip-3.mp4', 'clip-4.mp4']);
  assert.equal(completed.clips[1].onScreenHook, 'A Willyrex le cortan la retirada');
  assert.equal(completed.clips[1].title, 'Otro momento');
  assert.match(await readFile(join(directory, 'clip-4.ass'), 'utf8'), /Willyrex/);
  assert.ok(completed.clips[1].start >= old.end);
  assert.equal(await readFile(join(directory, old.file), 'utf8'), 'archivo anterior');
  assert.equal(await readFile(join(directory, 'youtube-uploads.json'), 'utf8'), '{"clip-3.mp4":{"videoId":"ya-publicado"}}');
  assert.equal((await getJob(id)).canSearchMore, true);
  // Once the second cut is exported, a further pass finds no unused speech long enough.
  const noMore = await finishSearch();
  assert.equal(noMore.stage, 'done', noMore.message);
  assert.match(noMore.message, /No se encontraron más/);
  assert.equal(noMore.clips.length, 2);
  assert.equal(selections, 1);
});

test('YouTube añade un proyecto dos horas después de la última programación real del canal', async () => {
  const now = Date.parse('2026-11-18T16:20:00Z');
  const latest = await getLatestScheduledUpload('test-token', 'test-uploads', { now, fetcher: async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/playlistItems')) {
      assert.equal(searchParams.get('playlistId'), 'test-uploads');
      return Response.json(searchParams.get('pageToken')
        ? { items: [{ contentDetails: { videoId: 'older-upload' } }] }
        : { nextPageToken: 'next', items: [{ contentDetails: { videoId: 'recent-upload' } }] });
    }
    return Response.json({ items: searchParams.get('id') === 'recent-upload'
      ? [{ status: { privacyStatus: 'private', publishAt: '2026-11-18T17:00:00Z' } }]
      : [
          { status: { privacyStatus: 'private', publishAt: '2026-11-18T19:30:00Z' } },
          { status: { privacyStatus: 'private', publishAt: '2026-11-18T14:00:00Z' } },
          { status: { privacyStatus: 'public' } },
        ] });
  } });
  const first = nextPublishDate({ intervalHours: 2, latest, now });
  assert.equal(first, '2026-11-18T21:30:00.000Z');
  assert.equal(nextPublishDate({ intervalHours: 2, latest: Date.parse(first), now }), '2026-11-18T23:30:00.000Z');
  assert.equal(nextPublishDate({ intervalHours: 2, now }), '2026-11-18T17:00:00.000Z');
  await assert.rejects(getLatestScheduledUpload('test-token', 'test-uploads', {
    fetcher: async () => new Response(null, { status: 403 }),
  }), /No se pudo comprobar la cola/);
});

test('YouTube retoma el archivo desde el byte confirmado tras un fallo de red', async (t) => {
  const path = join(await workspace(t), 'clip-1.mp4');
  await writeFile(path, 'abcdef');
  const metadata = { snippet: { title: 'Prueba' }, status: { privacyStatus: 'private' } };
  const requests = [];
  const fetcher = async (_url, options) => {
    requests.push(options.headers['Content-Range'] ?? 'POST');
    if (options.method === 'POST') return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' } });
    if (requests.length === 2) throw new TypeError('fetch failed');
    if (requests.length === 3) return new Response(null, { status: 308, headers: { range: 'bytes=0-2' } });
    const chunks = [];
    for await (const chunk of options.body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'def');
    return Response.json({ id: 'recovered' }, { status: 201 });
  };
  const options = { channelId: 'test-channel', fetcher, wait: async () => {} };
  const first = await uploadSingleClip('test-token', path, metadata, options);
  assert.deepEqual(requests, ['POST', 'bytes 0-5/6', 'bytes */6', 'bytes 3-5/6']);
  assert.equal(first.id, 'recovered');
  const recovered = await uploadSingleClip('test-token', path, metadata, { ...options, fetcher: async (_url, request) => {
    assert.equal(request.headers['Content-Range'], 'bytes */6');
    return Response.json({ id: 'recovered' });
  } });
  assert.equal(recovered.id, first.id);
});

test('YouTube muestra el límite diario del canal y separa las sesiones entre destinos', async (t) => {
  const directory = await workspace(t);
  const path = join(directory, 'clip-3.mp4');
  await writeFile(path, 'sample');
  const metadata = { snippet: { title: 'Prueba' }, status: { privacyStatus: 'private' } };
  const first = `UC${'a'.repeat(22)}`;
  const second = `UC${'b'.repeat(22)}`;
  await uploadSingleClip('first-token', path, metadata, {
    channelId: first,
    fetcher: async (_url, request) => request.method === 'POST'
      ? new Response(null, { headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=first' } })
      : Response.json({ id: 'first-video' }),
  });
  let calls = 0;
  await assert.rejects(uploadSingleClip('second-token', path, metadata, {
    channelId: second,
    fetcher: async (_url, request) => {
      calls++;
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.Authorization, 'Bearer second-token');
      return Response.json({ error: { errors: [{ reason: 'uploadLimitExceeded' }] } }, { status: 400 });
    },
  }), { code: 'uploadLimitExceeded', message: /límite diario de subidas/ });
  assert.equal(calls, 1);
});

test('normaliza las preferencias y descarta formatos inválidos', () => {
  assert.deepEqual(normalizeFormat(), defaultFormat);
  assert.deepEqual(normalizeFormat({ ratio: '4:5', layouts: ['split', 'fill', 'split'], fitCrop: '4:3' }).layouts, ['fill', 'split']);
  assert.throws(() => normalizeFormat({ ratio: '4:5', layouts: [], fitCrop: '4:3' }), { status: 400 });
  assert.throws(() => normalizeFormat({ ratio: '3:7', layouts: ['fit'], fitCrop: 'original' }), { status: 400 });
  assert.throws(() => normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original', contentCrop: 'bad' }), { status: 400 });
});

test('contentCrop elige lateral completo o franja inferior según cámaras y ajuste', () => {
  const basePlan = {
    layout: 'gameplay',
    tracks: [[{ offset: 0, x: 0.14, y: 0.19, cutBefore: false }], [{ offset: 0, x: 0.5, y: 0.5, cutBefore: false }]],
    regions: [{ width: 0.25, height: 0.34 }, { width: 1, height: 1 }],
  };
  const sidePlan = refineInsetPlan(basePlan, null, normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original', contentCrop: 'side' }));
  assert.ok(sidePlan.regions[1].height === 1 && sidePlan.regions[1].width < 0.8);

  const belowPlan = refineInsetPlan(basePlan, null, normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original', contentCrop: 'below' }));
  assert.ok(belowPlan.regions[1].width === 1 && belowPlan.regions[1].height < 0.7);

  const autoPortrait = refineInsetPlan(basePlan, null, normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original', contentCrop: 'auto' }));
  assert.ok(autoPortrait.regions[1].height === 1);

  const centeredCam = {
    layout: 'gameplay',
    tracks: [[{ offset: 0, x: 0.5, y: 0.18, cutBefore: false }], [{ offset: 0, x: 0.5, y: 0.5, cutBefore: false }]],
    regions: [{ width: 0.28, height: 0.32 }, { width: 1, height: 1 }],
  };
  const autoCentered = refineInsetPlan(centeredCam, null, normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original', contentCrop: 'auto' }));
  assert.equal(autoCentered.regions[1].width, 1);
});

test('chooseFraming adapta la cámara y el estilo de forma independiente por clip', async () => {
  const frames = [1, 2, 3].map((index) => ({ index, offset: index / 3, image: 'test' }));
  const media = { aspect: 16 / 9 };
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fill', 'gameplay'], fitCrop: 'original', contentCrop: 'side' });
  const movingClip = await chooseFraming(async () => ({
    layout: 'gameplay',
    reason: 'La cámara cambia de esquina tras el corte.',
    frames: [
      { index: 1, cutBefore: false, regions: [{ left: 0.02, top: 0.04, right: 0.26, bottom: 0.36 }, { left: 0, top: 0, right: 1, bottom: 1 }] },
      { index: 2, cutBefore: true, regions: [{ left: 0.72, top: 0.62, right: 0.98, bottom: 0.96 }, { left: 0, top: 0, right: 1, bottom: 1 }] },
      { index: 3, cutBefore: false, regions: [{ left: 0.72, top: 0.62, right: 0.98, bottom: 0.96 }, { left: 0, top: 0, right: 1, bottom: 1 }] },
    ],
  }), clip, frames, transcript, media, format);
  assert.equal(movingClip.layout, 'gameplay');
  assert.ok(movingClip.tracks[0][0].x < 0.3 && movingClip.tracks[0][1].x > 0.7);
  assert.ok(movingClip.tracks[1][0].x > 0.5 && movingClip.tracks[1][1].x < 0.5);
  assert.ok(movingClip.tracks[1][0].x - movingClip.regions[1].width / 2 >= 0.27);
  assert.ok(movingClip.tracks[1][1].x + movingClip.regions[1].width / 2 <= 0.71);

  const normalClip = await chooseFraming(async () => ({
    layout: 'fill',
    reason: 'Escena normal sin cámara incrustada.',
    frames: frames.map(({ index }) => ({ index, cutBefore: false, regions: [{ left: 0.35, top: 0.15, right: 0.65, bottom: 0.85 }] })),
  }), clip, frames, transcript, media, format);
  assert.equal(normalClip.layout, 'fill');

  const widePlan = cvFramingPlan(frames, normalizeFormat({ ratio: '9:16', layouts: ['fill', 'fit', 'gameplay'], fitCrop: 'original' }), media, {
    scene: { dominant: 'wide', scores: { wide: 0.82 } },
    frames: frames.map(({ index }) => ({ index, cutBefore: false, faces: [], actionBox: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 } })),
  });
  assert.equal(widePlan.layout, 'fit');

  const sharedPlan = cvFramingPlan(frames, normalizeFormat({ ratio: '9:16', layouts: ['fill', 'gameplay', 'shared'], fitCrop: 'original', contentCrop: 'side' }), media, {
    inset: { kind: 'shared', camera: { left: 0.01, top: 0.02, right: 0.25, bottom: 0.35 }, screen: { left: 0.27, top: 0, right: 1, bottom: 1 } },
    frames: frames.map(({ index }) => ({ index, cutBefore: false, faces: [], actionBox: { left: 0.3, top: 0.1, right: 0.9, bottom: 0.9 } })),
  });
  assert.equal(sharedPlan.layout, 'shared');
});

test('limita la IA a las composiciones elegidas y valida cajas e índices', async () => {
  const frames = [1, 2, 3].map((index) => ({ index, offset: index / 3, image: 'test' }));
  const media = { aspect: 16 / 9 };
  const box = (left, right) => ({ left, right, top: 0.1, bottom: 0.9 });
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit', 'split'], fitCrop: 'original' });
  const infer = async ({ schema }) => {
    assert.deepEqual(schema.properties.layout.enum, ['fit', 'split']);
    return { layout: 'split', reason: 'Dos personas.', frames: [
      { index: 1, cutBefore: false, regions: [box(0.1, 0.3), box(0.7, 0.9)] },
      { index: 2, cutBefore: true, regions: [box(0.2, 0.4), box(0.6, 0.8)] },
      { index: 3, cutBefore: false, regions: [box(0.4, 2), box(0.6, 0.8)] },
    ] };
  };
  const plan = await chooseFraming(infer, clip, frames, transcript, media, format);
  assert.equal(plan.layout, 'split');
  assert.deepEqual(plan.tracks.map((track) => track.length), [2, 2]);
  assert.equal(plan.tracks[0][1].cutBefore, true);
  const fallback = await chooseFraming(async () => ({ layout: 'gameplay', frames: [] }), clip, frames, transcript, media, format);
  assert.equal(fallback.layout, 'fit');
});

test('Gameplay tiene prioridad cuando la cámara y la partida siguen presentes', async () => {
  const frames = [1, 2, 3, 4, 5].map((index) => ({ index, offset: index / 4, image: 'test' }));
  const media = { aspect: 16 / 9 };
  const format = normalizeFormat({ ratio: '4:5', layouts: ['fill', 'fit', 'gameplay'], fitCrop: '4:3' });
  const camera = { left: 0.01, top: 0.02, right: 0.27, bottom: 0.35 };
  const screen = { left: 0, top: 0.35, right: 1, bottom: 1 };
  const frameMatches = { layout: 'gameplay', matches: 5, camera, screen, reason: 'La cámara aparece sobre la partida.' };
  const plan = await inspectInset(async () => frameMatches, frames, format, 'Partida');
  assert.equal(plan.layout, 'gameplay');
  assert.ok(plan.regions[0].width < 0.3 && plan.regions[1].width === 1);
  assert.equal(await inspectInset(async () => ({ ...frameMatches, matches: 2 }), frames, format, 'Partida'), null);
  assert.equal(await inspectInset(async () => { throw new Error('No debe llamar al motor'); }, frames, { ...format, layouts: ['fill'] }, 'Partida'), null);

  const response = { layout: 'fill', reason: 'Un foco claro.', frames: frames.map(({ index }) => ({
    index, cutBefore: false, regions: [{ left: 0.43, top: 0.25, right: 0.57, bottom: 0.65 }],
  })) };
  const kept = await chooseFraming(async () => ({ ...response, insetVisible: true }), clip, frames, transcript, media, format, plan);
  assert.equal(kept.layout, 'gameplay');
  const otherScene = await chooseFraming(async () => ({ ...response, insetVisible: false }), clip, frames, transcript, media, format, plan);
  assert.equal(otherScene.layout, 'fill');
});

test('FFmpeg exporta siete diseños, cuatro proporciones y las tres variantes de Ajustar', async (t) => {
  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'test.mp4');
  const colors = 'color=black:s=640x360:r=30:d=2.3,drawbox=0:0:320:180:red:t=fill,drawbox=320:0:320:180:green:t=fill,drawbox=0:180:320:180:blue:t=fill,drawbox=320:180:320:180:yellow:t=fill';
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', colors, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.3', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const cases = [
    ['fill', '9:16'], ['fit', '9:16'], ['split', '9:16'], ['three', '1:1'], ['four', '4:5'],
    ['shared', '16:9'], ['gameplay', '9:16'], ['fit', '4:5', '4:3'], ['fit', '1:1', '1:1'],
  ];
  for (const [index, [layout, ratio, fitCrop = 'original']] of cases.entries()) {
    await t.test(`${layout} ${ratio} ${fitCrop}`, async () => {
      const format = normalizeFormat({ ratio, layouts: [layout], fitCrop });
      const panels = layoutPanels(layout, ratio);
      const tracks = panels.map((_, panel) => [{ offset: 0, x: panel % 2 ? 0.75 : 0.25, y: panel < 2 ? 0.25 : 0.75 }]);
      const regions = panels.map(() => ({ width: 0.45, height: 0.45 }));
      const file = await renderClip(source, directory, clip, transcript, { layout, tracks, regions }, index + 1, format);
      const output = join(directory, file);
      const metadata = await probeVideo(output);
      assert.deepEqual([metadata.width, metadata.height], outputSize(format));
      assert.ok(metadata.audio && Math.abs(metadata.duration - clip.end) < 0.12);
      assert.match(await readFile(output.replace(/\.mp4$/, '.ass'), 'utf8'), /Dialogue: .*Así se conserva el subtítulo/);
      if (layout === 'four') {
        const pixel = (x, y) => execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.4', '-i', output, '-vf', `crop=4:4:${x}:${y},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
        const [r, g, b] = pixel(220, 280);
        const [r2, g2, b2] = pixel(760, 280);
        assert.ok(r > 180 && g < 50 && b < 50);
        assert.ok(g2 > 90 && r2 < 50 && b2 < 50);
      }
    });
  }
});

test('guarda borradores por plataforma y enlaza al instante del vídeo original', async (t) => {
  const directory = await workspace(t);
  const job = { id: 'test', videoId: 'GpUG3mJH6NE', title: 'Vídeo fuente' };
  const selected = { ...clip, start: 12.85, end: 22.4 };
  await savePublicationDraft(directory, selected, { platform: 'youtube', title: 'Texto de prueba', text: 'Descripción de prueba', hashtags: ['#Citas', 'citas', '#Opinión', 'no válido'] });
  const loaded = await loadPublication(directory, job, selected);
  assert.equal(loaded.platforms.youtube.status, 'draft');
  assert.deepEqual(loaded.platforms.youtube.hashtags, ['#Citas', '#Opinión']);
  assert.equal(loaded.platforms.tiktok.status, 'suggested');
  assert.ok(loaded.source.url.endsWith('v=GpUG3mJH6NE&t=12s'));
  assert.equal(loaded.publisher.handle, '@RisaWOW');
  await assert.rejects(() => savePublicationDraft(directory, selected, { platform: 'youtube', title: 'x'.repeat(101), text: 'Descripción' }), { status: 400 });

  const seoCount = await generatePublicationSuggestions(async () => ({
    ideas: [{
      id: 1,
      query: 'debate primera cita quien paga',
      seoKeywords: ['primera cita quien paga', 'citas incomodas español', 'debate citas'],
      seoScore: 91,
      hook: '¿Pagarías toda la primera cita?',
      coverText: '¿QUIÉN PAGA?',
      pinnedComment: '¿Team mitad y mitad o invita quien propone?',
      youtubeTitle: 'Se niega a pagar la primera cita por esta razón',
      youtubeText: 'Momento viral sobre quién debe invitar en la primera cita.',
      youtubeHashtags: ['citas', 'debate'],
      tiktokText: '¿Qué harías tú en esta situación?',
      tiktokHashtags: ['citas', 'humor'],
    }],
  }), directory, 'Vídeo fuente', { language: 'es', segments: [{ start: 13, end: 20, text: 'Así se vivió.' }] }, [selected]);
  assert.equal(seoCount, 1);
  const withSeo = await loadPublication(directory, job, selected);
  assert.equal(withSeo.seoScore, 91);
  assert.equal(withSeo.coverText, '¿QUIÉN PAGA?');
  assert.ok(withSeo.seoKeywords.includes('primera cita quien paga'));
  assert.ok(withSeo.pinnedComment.includes('Team'));
});

test('chooseClips aplica señales acústicas, rúbrica viral, recorte de silencio inicial y revisión única', async () => {
  const transcript = {
    language: 'es',
    segments: [
      { id: 1, start: 0, end: 12, text: 'Hola chicos hoy vamos a ver algo.', energy: 4, wps: 2.3, pauseBefore: 0, words: [{ start: 0.8, end: 1.1, text: 'Hola' }] },
      { id: 2, start: 13.2, end: 25, text: '¿De verdad pagas tú la cena siempre?', energy: 9, wps: 4.1, pauseBefore: 1.2, words: [{ start: 13.7, end: 14.0, text: '¿De' }, { start: 24.4, end: 24.9, text: 'siempre?' }] },
      { id: 3, start: 26, end: 40, text: 'Si no pagas la primera cita, ni me escribas.', energy: 8, wps: 3.6, pauseBefore: 1.0, words: [{ start: 26.2, end: 26.5, text: 'Si' }, { start: 39.5, end: 39.9, text: 'escribas.' }] },
    ],
  };
  let calls = 0;
  const infer = async ({ parts }) => {
    calls++;
    const payload = JSON.parse(parts[0].text);
    if (calls === 1) {
      assert.equal(payload.sourceTitle, 'Citas polémicas');
      assert.equal(payload.segments[1].energy, 9);
      assert.equal(payload.segments[1].pauseBefore, 1.2);
      return {
        clips: [
          {
            startSegmentId: 1, endSegmentId: 1, title: 'Intro floja', onScreenHook: 'Mira esto', category: 'historia',
            reason: 'Saludo inicial', hookScore: 4, retentionScore: 7, shareScore: 7, clarityScore: 7, score: 8,
          },
          {
            startSegmentId: 2, endSegmentId: 2, title: 'Debate cita', onScreenHook: '¿Quién paga la primera cita?', category: 'conflicto',
            reason: 'Pregunta directa con pico de energía', hookScore: 9, retentionScore: 8.5, shareScore: 9, clarityScore: 8.5, score: 9,
          },
          {
            startSegmentId: 3, endSegmentId: 3, title: 'Regla radical', onScreenHook: '¿Si no paga no hay segunda?', category: 'reaccion',
            reason: 'Afirmación polarizante', hookScore: 8.5, retentionScore: 8, shareScore: 8.5, clarityScore: 8, score: 8.5,
          },
        ],
      };
    }
    assert.equal(payload.candidates.length, 2);
    return { selected: [1] };
  };
  const selected = await chooseClips(infer, transcript, { duration: 45 }, async () => {}, false, { sourceTitle: 'Citas polémicas' });
  assert.equal(calls, 2);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].onScreenHook, '¿Quién paga la primera cita?');
  assert.equal(selected[0].peakEnergy, 9);
  assert.ok(selected[0].start >= 13.55 && selected[0].start <= 13.7);
});

test('renderClip genera subtítulos dinámicos por palabra, gancho inicial y señales de audio', async (t) => {
  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'speech-src.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=2.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.4', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const timedTranscript = {
    language: 'es',
    segments: [{
      id: 1, start: 0.1, end: 2.1, text: 'Esto cambia todo ahora.',
      words: [
        { start: 0.1, end: 0.5, text: 'Esto' },
        { start: 0.5, end: 1.0, text: 'cambia' },
        { start: 1.0, end: 1.5, text: 'todo' },
        { start: 1.5, end: 2.1, text: 'ahora.' },
      ],
    }],
  };
  const enriched = await analyzeAudioSignals(source, timedTranscript);
  assert.ok(Number.isFinite(enriched.segments[0].energy) && enriched.segments[0].wps > 1);
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });
  const file = await renderClip(source, directory, { ...clip, end: 2.3, onScreenHook: 'Reto en directo: ¿Por qué ocurre ESTO?' }, enriched, { layout: 'fit', tracks: [[]], regions: [] }, 1, format, { aspect: 16 / 9 });
  const ass = await readFile(join(directory, file.replace(/\.mp4$/, '.ass')), 'utf8');
  assert.match(ass, /Style: Hook,Arial Black,/);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:02\.30,Hook,,0,0,0,,\{\\an5\\pos\(540,360\)\\fscx84\\fscy84\\t\(0,170,\\fscx108\\fscy108\)\\t\(170,290,\\fscx100\\fscy100\)\}.*directo:.*ESTO/);
  assert.match(ass, /\{\\c&H0000EAFF&\\fscx112\\fscy112\}cambia\{\\r\}/);

  const fillFormat = normalizeFormat({ ratio: '9:16', layouts: ['fill'], fitCrop: 'original' });
  const fillFile = await renderClip(source, directory, { ...clip, end: 2.3, onScreenHook: '¿Por qué ocurre ESTO?' }, enriched, { layout: 'fill', tracks: [[{ offset: 0, x: 0.5, y: 0.5 }]], regions: [] }, 2, fillFormat, { aspect: 16 / 9 });
  const fillAss = await readFile(join(directory, fillFile.replace(/\.mp4$/, '.ass')), 'utf8');
  assert.match(fillAss, /Dialogue: 1,0:00:00\.00,0:00:01\.2[67],Hook,,0,0,0,,\{\\fscx84\\fscy84\\t\(0,170,\\fscx108\\fscy108\)\\t\(170,290,\\fscx100\\fscy100\)\\fad\(80,260\)\}.*ESTO\?/);
});

test('cancelAllJobs y AbortSignal interrumpen inmediatamente los procesos activos', async (t) => {
  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'cancel-src.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=1.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => processVideo(source, directory, { provider: 'gemini', key: 'x' }, async () => {}, { signal: controller.signal }),
    { code: 'CANCELLED' },
  );
  const idle = await cancelAllJobs();
  assert.equal(idle.cancelled, false);
});

test('buildAgentCandidates, buildAgentFramingPlan y saveAgentSeoSuggestion orquestan el flujo agente MCP', async (t) => {
  const directory = await workspace(t);
  const segs = [
    { id: 1, start: 1.0, end: 12.0, energy: 8.5, pauseBefore: 0.9, text: 'Primera parte clave del directo.', words: [{ start: 1.05, end: 1.5, text: 'Primera' }, { start: 11.4, end: 11.9, text: 'directo.' }] },
    { id: 2, start: 12.1, end: 24.0, energy: 7.9, pauseBefore: 0.2, text: 'Remate inesperado aquí.', words: [{ start: 12.2, end: 12.8, text: 'Remate' }, { start: 23.2, end: 23.9, text: 'aquí.' }] },
  ];
  const candidates = buildAgentCandidates([{
    startSegmentId: 1,
    endSegmentId: 2,
    title: 'Resumen: Lo que ocurrió en el directo',
    onScreenHook: 'CASI PIERDE EL RETO',
    category: 'Gameplay',
    reason: 'Clímax con energía alta y cierre limpio.',
    score: 8.8,
  }], segs, 60);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, 'Lo que ocurrió en el directo');
  assert.equal(candidates[0].onScreenHook, 'CASI PIERDE EL RETO');

  const framing = buildAgentFramingPlan([{ index: 0, offset: 0 }], defaultFormat, { aspect: 16 / 9 }, {
    layout: 'gameplay',
    cameraBox: { left: 0.02, top: 0.04, right: 0.25, bottom: 0.35 },
    screenBox: { left: 0, top: 0, right: 1, bottom: 1 },
  });
  assert.equal(framing.layout, 'gameplay');
  assert.equal(framing.boxes.length, 2);
  assert.ok(framing.boxes[1].x - framing.boxes[1].width / 2 >= 0.24, 'El área de juego evita la cámara web');

  const seo = await saveAgentSeoSuggestion(directory, 'clip-1.mp4', {
    query: 'como ganar reto imposible',
    hook: 'Nadie esperaba este final en el directo.',
    seoKeywords: ['gameplay', 'directo', 'reto'],
    coverText: 'FINAL EPICO',
    pinnedComment: '¿Habrías hecho lo mismo?',
    seoScore: 93,
    youtubeTitle: 'El giro más loco del directo #Shorts',
    youtubeText: 'Momento exacto donde todo cambia.',
    youtubeHashtags: ['shorts', 'gaming'],
    tiktokText: 'Lo viste venir o no?',
    tiktokHashtags: ['gaming', 'viral'],
  });
  assert.equal(seo.seoScore, 93);
  assert.equal(seo.coverText, 'FINAL EPICO');
});

test('servidor MCP corte-studio responde initialize, tools/list y tools/call por stdio', async () => {
  const mcpPath = join(process.cwd(), 'mcp', 'corte-studio-mcp.mjs');
  const child = spawn(process.execPath, [mcpPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? '';
    for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
  });

  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_inspect_formats', arguments: {} } });
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'studio_list_projects', arguments: { limit: 3 } } });

  const deadline = Date.now() + 8000;
  while (lines.length < 4 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40));
  }
  child.stdin.end();
  await new Promise((r) => child.once('exit', r));

  const byId = new Map(lines.map((item) => [item.id, item]));
  assert.equal(byId.get(1)?.result?.serverInfo?.name, 'corte-studio');
  const toolNames = byId.get(2)?.result?.tools?.map((t) => t.name) ?? [];
  assert.ok(toolNames.includes('studio_prepare_video'));
  assert.ok(toolNames.includes('studio_read_transcript_window'));
  assert.ok(toolNames.includes('studio_analyze_clip_frames'));
  assert.ok(toolNames.includes('studio_render_clip'));
  const formatsPayload = JSON.parse(byId.get(3).result.content[0].text);
  assert.equal(formatsPayload.defaultFormat.ratio, '9:16');
  const projectsPayload = JSON.parse(byId.get(4).result.content[0].text);
  assert.ok(Array.isArray(projectsPayload.projects));
});

test('parseVideoSource y sourceFromJob reconocen YouTube y Twitch (directo, VOD y clip)', () => {
  const { parseVideoSource, sourceFromJob } = youtubeMod;

  const live = parseVideoSource('https://www.twitch.tv/DjMaRiiO');
  assert.deepEqual(live, {
    platform: 'twitch',
    kind: 'live',
    channel: 'djmariio',
    videoId: 'twitch-live-djmariio',
    url: 'https://www.twitch.tv/djmariio',
    label: 'twitch.tv/djmariio',
  });

  const vod = parseVideoSource('https://www.twitch.tv/videos/2930644638?t=01h12m00s');
  assert.equal(vod.platform, 'twitch');
  assert.equal(vod.kind, 'vod');
  assert.equal(vod.videoId, 'twitch-vod-2930644638');
  assert.equal(vod.url, 'https://www.twitch.tv/videos/2930644638');

  const channelVod = parseVideoSource('https://www.twitch.tv/djmariio/video/2927735073');
  assert.equal(channelVod.videoId, 'twitch-vod-2927735073');

  const clipUrl = parseVideoSource('https://clips.twitch.tv/FunnyClipSlugHere');
  assert.equal(clipUrl.kind, 'clip');
  assert.equal(clipUrl.videoId, 'twitch-clip-FunnyClipSlugHere');

  assert.equal(parseVideoSource('https://www.twitch.tv/directory'), null);

  const yt = parseVideoSource('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(yt.platform, 'youtube');
  assert.equal(yt.videoId, 'dQw4w9WgXcQ');

  const legacy = sourceFromJob({ videoId: 'twitch-vod-2927735073' });
  assert.equal(legacy.url, 'https://www.twitch.tv/videos/2927735073');
});

test('twitch_snapshot freeze_m3u8_snapshot congela playlists EVENT vivas con #EXT-X-ENDLIST', async (t) => {
  const directory = await workspace(t);
  const py = await resolvePython();
  const raw = execFileSync(py, [
    '-c',
    `import json, sys; sys.path.insert(0, 'pipeline'); import twitch_snapshot as ts
m3u8 = "#EXTM3U\\n#EXT-X-PLAYLIST-TYPE:EVENT\\n#EXT-X-MAP:URI=\\"init-0.mp4\\"\\n#EXTINF:10.000,\\n0.mp4\\n#EXTINF:10.000,\\n1.mp4\\n"
path, segs, dur = ts.freeze_m3u8_snapshot("https://cdn.example.com/v1/chunk/index.m3u8", m3u8, ${JSON.stringify(directory)})
print(json.dumps({"path": path, "segs": segs, "dur": dur}))`,
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(raw.trim());
  assert.equal(parsed.segs, 2);
  assert.equal(parsed.dur, 20);
  const frozen = await readFile(parsed.path, 'utf8');
  assert.match(frozen, /https:\/\/cdn\.example\.com\/v1\/chunk\/init-0\.mp4/);
  assert.match(frozen, /https:\/\/cdn\.example\.com\/v1\/chunk\/0\.mp4/);
  assert.match(frozen, /#EXT-X-ENDLIST$/m);
});

test('gameplay pide una acción concreta si el rótulo solo dice «mira lo que pasa»', async () => {
  let attempts = 0;
  const copy = await refineGameplayHook(async ({ system, parts, schema }) => {
    attempts++;
    assert.deepEqual(schema.required, ['onScreenHook']);
    assert.match(system, /no demuestra por sí solo quién juega/);
    assert.equal(JSON.parse(parts[0].text).sourceChannel, 'Compilaciones del juego');
    return { onScreenHook: attempts === 1 ? '¡Mira lo que pasa!' : 'Mira qué pasa cuando rompe el puente' };
  }, clip, [{ image: 'AAAA' }], transcript, 'Cruce del puente', 'Compilaciones del juego');
  assert.deepEqual(copy, { onScreenHook: 'Mira qué pasa cuando rompe el puente' });
  assert.equal(attempts, 2);
});

test('gameplay mantiene el título persistente todo el clip en la franja superior sobre la partida', async (t) => {
  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'gp-src.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=navy:s=640x360:r=30:d=2.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.4', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const format = normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original' });
  const plan = {
    layout: 'gameplay',
    tracks: [[{ offset: 0, x: 0.9, y: 0.38 }], [{ offset: 0, x: 0.39, y: 0.5 }]],
    regions: [{ width: 0.2, height: 0.3 }, { width: 0.7876, height: 1 }],
  };
  const file = await renderClip(source, directory, { ...clip, end: 2.3, onScreenHook: 'Willyrex intenta robar el avión y se atasca' }, transcript, plan, 1, format, { aspect: 16 / 9 });
  const ass = await readFile(join(directory, file.replace(/\.mp4$/, '.ass')), 'utf8');
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:02\.30,Hook,,0,0,0,,\{\\an5\\pos\(540,690\)/);
  assert.ok(Number(/Style: Hook,Arial Black,(\d+)/.exec(ass)[1]) >= 72);
  assert.match(ass.split('\n').find((line) => line.startsWith('Dialogue: 1,')), /\\N/);
});

test('generatePublicationSuggestions analiza 1 a 1 con fotogramas y guarda SEO completo', async (t) => {
  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const framePath = join(directory, 'frame-1-1.jpg');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:d=0.1', '-frames:v', '1', framePath]);
  let sawImage = false;
  const infer = async ({ parts }) => {
    if (parts.some((p) => p.inline_data?.mime_type === 'image/jpeg')) sawImage = true;
    return {
      ideas: [{
        id: 1,
        game: 'GTA 6',
        query: 'gta 6 taser policia realismo',
        seoKeywords: ['gta 6 taser', 'gta vi policia', 'gta 6 detalles', 'gta 6 clips', 'gta vi mundo abierto', 'shorts gta 6'],
        seoScore: 95,
        hook: 'La policía te tasea en GTA 6 y pierdes tu gorra y tu arma al instante.',
        coverText: 'TASEADO AL SUELO',
        pinnedComment: '¿Habías visto ese detalle al perder la gorra?',
        youtubeTitle: 'La policía te TASEA así en GTA 6 y pierdes todo ⚡',
        youtubeText: 'Físicas y realismo policial en GTA VI sin spoilers de historia.',
        youtubeHashtags: ['#GTA6', '#GTAVI', '#Gaming'],
        tiktokText: 'El taser de GTA 6 es brutal ⚡',
        tiktokHashtags: ['#gta6', '#gtavi', '#gaming', '#risawow'],
      }],
    };
  };
  const res = await analyzeAndSaveClipSeo(infer, directory, 'GTA 6 Gameplay', transcript, { ...clip, start: 0, end: 2.2 }, 1);
  assert.equal(sawImage, true);
  assert.equal(res.game, 'GTA 6');
  assert.equal(res.seoScore, 95);
  assert.equal(res.seoKeywords.length, 8);
  assert.equal(res.coverText, 'TASEADO AL SUELO');
});

test('youtube_live find_earliest_seq y parseVideoSource /live/ detectan directos de YouTube desde el principio', async () => {
  const ytLive = youtubeMod.parseVideoSource('https://www.youtube.com/live/biUVW6Q0f2g');
  assert.equal(ytLive.platform, 'youtube');
  assert.equal(ytLive.kind, 'live');
  assert.equal(ytLive.videoId, 'biUVW6Q0f2g');

  const py = await resolvePython();
  const raw = execFileSync(py, [
    '-c',
    `import json, sys; sys.path.insert(0, 'pipeline'); import youtube_live as yl
yl.probe_seq = lambda _u, sq: sq >= 320
print(json.dumps({"zero": yl.find_earliest_seq("https://example.com", 1000)}))`,
  ], { encoding: 'utf8' });
  assert.equal(JSON.parse(raw.trim()).zero, 320);
});

test('gameplay SEO detecta juego, hashtags del juego, keywords y metadatos YouTube', async (t) => {
  const directory = await workspace(t);
  const inferValorant = async () => ({
    ideas: [{
      id: 1,
      game: 'Valorant',
      query: 'valorant clutch ace 1v5 ranked',
      seoKeywords: ['clutch 1v5', 'radiante'],
      seoScore: 93,
      hook: 'Se saca un clutch 1v5 imposible con Jett en el último segundo de Ascent.',
      coverText: 'CLUTCH 1V5 IMPOSIBLE',
      pinnedComment: '¿Crees que el último tiro fue suerte o puro aim?',
      youtubeTitle: 'El clutch 1v5 más loco en Valorant Ascent 🎯',
      youtubeText: 'Jugada imposible en ranked con Jett defendiendo la spike.',
      youtubeHashtags: ['#Shorts', '#Jett'],
      tiktokText: 'Mira este clutch 1v5 en Valorant.',
      tiktokHashtags: ['#Gaming', '#Jett'],
    }],
  });
  const valClip = { file: 'clip-1.mp4', title: 'Clutch imposible', start: 0, end: 2.2, framing: { layout: 'gameplay' } };
  const seo = await analyzeAndSaveClipSeo(inferValorant, directory, 'Directo Ranked Ascent', transcript, valClip, 1);
  assert.equal(seo.game, 'Valorant');
  assert.ok(seo.platforms.youtube.hashtags.includes('#Valorant'));
  assert.ok(seo.platforms.tiktok.hashtags.includes('#Valorant'));
  assert.ok(seo.seoKeywords.some((k) => k.includes('valorant')));

  const fallbackDir = await workspace(t);
  const mcClip = { file: 'clip-1.mp4', title: 'Creeper gigante en mi casa', start: 0, end: 2.2, framing: { layout: 'gameplay' } };
  const fallbackSeo = await analyzeAndSaveClipSeo(null, fallbackDir, 'Survival en Minecraft Extremo', transcript, mcClip, 1);
  assert.equal(fallbackSeo.game, 'Minecraft');
  assert.ok(fallbackSeo.platforms.youtube.hashtags.includes('#Minecraft'));

  const agentSeo = await saveAgentSeoSuggestion(directory, 'clip-2.mp4', {
    game: 'Hollow Knight',
    query: 'hollow knight jefe secreto',
    hook: 'Derrota al jefe más difícil sin recibir un solo golpe.',
    youtubeTitle: 'Jefe imposible sin daño',
    youtubeText: 'Combate perfecto contra el jefe final.',
    youtubeHashtags: ['#NoHit'],
    tiktokText: 'Boss fight perfecta sin recibir daño.',
    tiktokHashtags: ['#NoHit'],
  });
  assert.equal(agentSeo.game, 'Hollow Knight');
  assert.ok(agentSeo.platforms.youtube.hashtags.includes('#HollowKnight'));

  const ytGameMeta = buildVideoMetadata(mcClip, agentSeo, undefined, null, 'Boss fight Hollow Knight');
  assert.equal(ytGameMeta.snippet.categoryId, '20');
  assert.match(ytGameMeta.snippet.description, /#HollowKnight/);
  assert.match(ytGameMeta.snippet.description, /Juego: Hollow Knight/);
  assert.ok(ytGameMeta.snippet.tags.includes('HollowKnight'));

  const ytGeneralMeta = buildVideoMetadata(clip, {
    query: 'debate podcast hoy',
    hook: 'Opinión polémica sobre tecnología.',
    platforms: { youtube: { title: 'Opinión polémica', text: 'Charla completa del episodio.', hashtags: ['#Podcast'] } },
  }, undefined, null, 'Podcast semanal');
  assert.equal(ytGeneralMeta.snippet.categoryId, '24');
});

test('gameplay, shared y fit colocan el vídeo más arriba para no quedar tapado en móvil', () => {
  const gpPanels = layoutPanels('gameplay', '9:16');
  const shPanels = layoutPanels('shared', '9:16');
  assert.equal(gpPanels[1].y, 594);
  assert.equal(shPanels[1].y, 710);

  // En 9:16 con 16:9 gameplay (608px alto), debe quedar > 430px libres abajo tanto en gameplay, shared y fit
  const gpTopOffset = containOffsetY(gpPanels[1].height, 608, 'bottom');
  const gpBottomClear = 1920 - (gpPanels[1].y + gpTopOffset + 608);
  assert.equal(gpTopOffset, 200);
  assert.ok(gpBottomClear >= 500, `gameplay bottom clear ${gpBottomClear}`);

  const shTopOffset = containOffsetY(shPanels[1].height, 608, 'bottom');
  const shBottomClear = 1920 - (shPanels[1].y + shTopOffset + 608);
  assert.ok(shBottomClear >= 430, `shared bottom clear ${shBottomClear}`);

  const fitTopOffset = containOffsetY(1920, 608, 'fit');
  assert.equal(fitTopOffset, 524);
  assert.ok(1920 - (fitTopOffset + 608) >= 780);

  const fitGraph = compositionGraph({ layout: 'fit', tracks: [[]], regions: [] }, normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' }));
  assert.match(fitGraph, /overlay=\(W-w\)\/2:trunc\(\(H-h\)\*0\.4\/2\)\*2/);

  const gpGraph = compositionGraph({
    layout: 'gameplay',
    tracks: [[{ offset: 0, x: 0.9, y: 0.25 }], [{ offset: 0, x: 0.5, y: 0.5 }]],
    regions: [{ width: 0.2, height: 0.3 }, { width: 1, height: 1 }],
  }, normalizeFormat({ ratio: '9:16', layouts: ['gameplay'], fitCrop: 'original' }));
  assert.match(gpGraph, /overlay=\(W-w\)\/2:trunc\(\(H-h\)\*0\.28\/2\)\*2/);
});

test('modo prototipo recorta la cámara del youtuber, limita <=30s, narra con locutor local y pausa/reanuda con animación', async (t) => {
  const protoTranscript = {
    language: 'es',
    segments: [
      { id: 1, start: 0, end: 12, text: 'Voy a intentar robar esta tienda rápida.', energy: 8.5, wps: 3.1, pauseBefore: 0.9, words: [{ start: 0.3, end: 1.0, text: 'Voy' }, { start: 11.2, end: 11.9, text: 'rápida.' }] },
      { id: 2, start: 12.1, end: 28, text: '¡Me acaban de rodear veinte patrullas!', energy: 9.2, wps: 3.5, pauseBefore: 0.4, words: [{ start: 12.2, end: 13.0, text: '¡Me' }, { start: 27.0, end: 27.8, text: 'patrullas!' }] },
    ],
  };
  const clips = await chooseClips(
    async ({ parts }) => {
      const payload = JSON.parse(parts[0].text);
      if (payload.candidates) return { selected: [1] };
      return {
        clips: [{
          startSegmentId: 1,
          endSegmentId: 2,
          title: 'Intenta robar en GTA y llegan 20 patrullas',
          onScreenHook: 'LO QUE PASÓ EN GTA',
          narration: 'Esto fue lo que le pasó a Willyrex cuando intentó robar en una tienda de GTA.',
          category: 'reaccion',
          reason: 'Arranca en acción y gira rápido.',
          hookScore: 8.8, retentionScore: 8.7, shareScore: 8.4, clarityScore: 8.9, score: 8.7,
        }],
      };
    },
    protoTranscript,
    { duration: 60 },
    () => {},
    false,
    { sourceTitle: 'ROBANDO EN GTA | Willyrex', mode: 'prototype' },
  );
  assert.equal(clips.length, 1);
  assert.ok(clips[0].end - clips[0].start <= 24.5);
  assert.match(clips[0].narration, /Willyrex/);

  const sceneWithCam = {
    inset: {
      kind: 'gameplay',
      camera: { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 },
      screen: { left: 0, top: 0, right: 1, bottom: 1 },
    },
    frames: [{ index: 1, cameraBox: { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }, faces: [] }],
  };
  const protoFraming = choosePrototypeFraming([{ index: 1, offset: 0 }], { aspect: 16 / 9 }, defaultFormat, sceneWithCam);
  assert.equal(protoFraming.layout, 'fit');
  assert.ok(protoFraming.regions[0].width < 0.8 || protoFraming.regions[0].height < 0.8);
  assert.ok(protoFraming.tracks[0][0].x < 0.76);

  const voices = await listVoiceModels();
  assert.ok(voices.some((v) => v.id === 'piper:es_ES-davefx-medium'));

  const directory = await workspace(t);
  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'proto-unit-src.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=0x162447:s=640x360:r=30:d=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const file = await renderPrototypeClip(source, directory, {
    file: 'clip-1.mp4',
    title: 'Robo en tienda GTA',
    onScreenHook: 'LO QUE PASÓ EN GTA',
    narration: 'Esto fue lo que le pasó a Willyrex en GTA.',
    start: 0,
    end: 10.5,
  }, {
    segments: [{ start: 0.2, end: 8.5, text: 'Corre, ahora.', words: [{ start: 0.2, end: 0.54, text: 'Corre,' }, { start: 1.0, end: 2.0, text: 'ahora.' }] }],
  }, protoFraming, 1, normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' }), {
    aspect: 16 / 9,
    voice: 'piper:es_ES-davefx-medium',
    audioSegments: [{ start: 5, end: 5.5, text: '¡Ya llegaron!', energy: 9 }],
  });

  const meta = await probeVideo(join(directory, file));
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.audio, true);
  assert.ok(meta.duration > 10 && meta.duration <= 30, `duration ${meta.duration}`);
  const ass = await readFile(join(directory, file.replace(/\.mp4$/, '.ass')), 'utf8');
  assert.match(ass, /II  PAUSA/);
  assert.match(ass, /\\fscx1\\t\(0,\d+,\\fscx100\)/);
  assert.match(ass, /Dialogue: 0,0:00:00\.20,0:00:00\.54,Corte/);
  assert.match(ass, /Dialogue: 0,0:00:0[2-6]\.\d{2},[^,]+,Corte,,0,0,0,,ahora\./);
  assert.match(ass, /Style: Narrator/);
  assert.match(ass, /Willyrex/);
});

test('prototipo revisa el gancho con diálogo y fotogramas y conserva el borrador si el motor no entrega un texto válido', async () => {
  const clip = { start: 10, end: 20, onScreenHook: 'LA MANSIÓN SECRETA', narration: 'Encontró un secreto que nadie esperaba dentro de la mansión.' };
  const sections = { segments: [
    { start: 0, end: 1, text: 'Fuera del corte.' },
    { start: 10, end: 13, text: 'Lo encontré. ¡Soy la bestia!' },
  ] };
  const frames = [{ image: 'AAAA' }, { image: 'BBBB' }];
  const revised = { onScreenHook: '¿Qué acaba de encontrar?', narration: 'Llevaba un rato buscando y su reacción lo dice todo.' };
  const result = await refinePrototypeCopy(async ({ parts }) => {
    assert.equal(parts.length, 3);
    assert.equal(JSON.parse(parts[0].text).dialogue, 'Lo encontré. ¡Soy la bestia!');
    assert.equal(parts[2].inline_data.data, 'BBBB');
    return revised;
  }, clip, frames, sections, 'Carrera en GTA');
  assert.deepEqual(result, revised);
  assert.deepEqual(await refinePrototypeCopy(async () => ({ ...revised, narration: 'Uy.' }), clip, frames, sections), {});
  assert.deepEqual(await refinePrototypeCopy(async () => null, clip, frames, sections), {});
});

test('chooseFraming corrige regiones invertidas en gameplay y prototipo excluye webcam por vision', async () => {
  const frames = [{ index: 1, offset: 0, image: 'AAAA' }, { index: 2, offset: 1, image: 'AAAA' }];
  const sceneData = {
    inset: { kind: 'gameplay', camera: { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }, screen: { left: 0, top: 0, right: 1, bottom: 1 } },
    frames: [
      { index: 1, cutBefore: false, cameraBox: { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }, faces: [{ left: 0.83, top: 0.09, right: 0.92, bottom: 0.24 }] },
      { index: 2, cutBefore: false, cameraBox: { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }, faces: [{ left: 0.83, top: 0.09, right: 0.92, bottom: 0.24 }] },
    ],
  };
  // Simula LLM devolviendo las regiones al revés: [gameplay_grande, camara_pequena]
  const swappedInfer = async () => ({
    layout: 'gameplay',
    reason: 'Invertido por error',
    frames: [
      { index: 1, cutBefore: false, regions: [{ left: 0, top: 0, right: 0.75, bottom: 1 }, { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }] },
      { index: 2, cutBefore: false, regions: [{ left: 0, top: 0, right: 0.75, bottom: 1 }, { left: 0.76, top: 0.03, right: 0.99, bottom: 0.34 }] },
    ],
  });
  const fixedPlan = await chooseFraming(swappedInfer, clip, frames, transcript, { aspect: 16 / 9 }, defaultFormat, null, sceneData);
  assert.equal(fixedPlan.layout, 'gameplay');
  // Panel 0 (arriba) debe ser la cámara pequeña (x ~ 0.875) y Panel 1 (abajo) el gameplay (x < 0.5)
  assert.ok(fixedPlan.tracks[0][0].x > 0.75, `expected panel 0 to be cam, got x=${fixedPlan.tracks[0][0].x}`);
  assert.ok(fixedPlan.tracks[1][0].x < 0.5, `expected panel 1 to be game, got x=${fixedPlan.tracks[1][0].x}`);
  assert.ok(fixedPlan.regions[0].width < 0.4);
  assert.ok(fixedPlan.regions[1].width > 0.5);

  // Prototipo: si OpenCV no trajo cámara, llama a infer para detectarla y excluirla del plano final
  const noCvProto = await chooseFraming(
    async () => ({ hasCamera: true, cameraBox: { left: 0.02, top: 0.04, right: 0.26, bottom: 0.34 } }),
    clip, frames, transcript, { aspect: 16 / 9 }, defaultFormat, null, { frames: [] }, { mode: 'prototype' },
  );
  assert.equal(noCvProto.layout, 'fit');
  assert.ok(noCvProto.tracks[0][0].x > 0.30, 'excluded top-left cam');
  assert.ok(noCvProto.regions[0].width >= 0.68);
});
