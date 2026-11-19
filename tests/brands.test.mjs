import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';
import { brandTag, brandsFile, deleteBrand, genericBrand, getBrand, loadBrands, normalizeBrand, saveBrand, saveBrandLogo, watermarkOverlay } from '../pipeline/brands.mjs';
import { handleBrandsRoute } from '../routes/brands-routes.mjs';

const origin = 'http://127.0.0.1:4173';
const fixture = { defaultBrandId: 'risawow', brands: [{ id: 'risawow', name: 'RisaWOW', handle: '@RisaWOW', showWatermark: true, accentHex: '#FFE600', defaultHashtags: ['#gameplay', '#clips'] }] };
const restore = () => writeFile(brandsFile, JSON.stringify(fixture));

function call(method, pathname, { body, headers = {} } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  request.method = method;
  request.headers = { origin, 'content-type': 'application/json', ...headers };
  const result = {};
  const sendJson = (_response, status, payload) => { result.status = status; result.payload = payload; };
  return handleBrandsRoute({ request, response: {}, pathname, origin, sendJson }).then((handled) => ({ handled, ...result }));
}

test('normalizeBrand valida y normaliza cada campo', () => {
  const brand = normalizeBrand({ id: 'Mi-Canal', name: '  Mi   Canal ', handle: 'mi.canal', showWatermark: true, accentHex: '#aabbcc', defaultHashtags: ['gaming', '#clips', 'gaming'] });
  assert.equal(brand.id, 'mi-canal');
  assert.equal(brand.name, 'Mi Canal');
  assert.equal(brand.handle, '@mi.canal');
  assert.equal(brand.accentHex, '#AABBCC');
  assert.deepEqual(brand.defaultHashtags, ['#gaming', '#clips']);
  assert.equal(normalizeBrand({ id: 'sin-handle', name: 'X', showWatermark: true }).showWatermark, false, 'sin handle no hay marca de agua');
  for (const bad of [{ id: 'A', name: 'x' }, { id: 'ok-id', name: '' }, { id: 'ok-id', name: 'x', accentHex: 'rojo' },
    { id: 'ok-id', name: 'x', handle: 'con espacios!' }, { id: 'ok-id', name: 'x', subtitlePreset: 'inventado' },
    { id: 'ok-id', name: 'x', logoPath: '../../secreto.png' }, { id: 'ok-id', name: 'x', logoPath: 'C:/Windows/logo.png' },
    { id: 'ok-id', name: 'x', bgmVolumeDb: 5 }, { id: 'ok-id', name: 'x', bgmFolder: '/etc' }]) {
    assert.throws(() => normalizeBrand(bad), { status: 400 }, JSON.stringify(bad));
  }
});

test('las marcas se guardan de forma atómica, se pueden editar, elegir por defecto y borrar', async (t) => {
  t.after(restore);
  await restore();
  assert.equal((await getBrand('inexistente')).id, 'risawow', 'una marca desconocida cae en la predeterminada');
  const created = await saveBrand({ id: 'cocina', name: 'Cocina Rápida', handle: '@cocinarapida', showWatermark: true, seoVoice: 'chef cercano' }, { makeDefault: true });
  assert.equal(created.seoVoice, 'chef cercano');
  assert.equal((await loadBrands()).defaultBrandId, 'cocina');
  const edited = await saveBrand({ id: 'cocina', accentHex: '#00FF88' });
  assert.equal(edited.accentHex, '#00FF88');
  assert.equal(edited.handle, '@cocinarapida', 'una edición parcial conserva el resto');
  assert.equal((await deleteBrand('cocina')).defaultBrandId, 'risawow');
  await assert.rejects(() => deleteBrand('risawow'), { status: 409 });
  await assert.rejects(() => deleteBrand('nada'), { status: 404 });
  JSON.parse(await readFile(brandsFile, 'utf8'));
});

test('un archivo de marcas ausente o dañado equivale a la marca genérica y no rompe el estudio', async (t) => {
  t.after(restore);
  await rm(brandsFile, { force: true });
  assert.equal((await getBrand()).id, genericBrand.id);
  await writeFile(brandsFile, '{ esto no es json');
  assert.equal((await loadBrands()).brands[0].id, genericBrand.id);
  await writeFile(brandsFile, JSON.stringify({ defaultBrandId: 'x', brands: [{ id: 'MAL ID' }, { id: 'bueno', name: 'Bueno' }] }));
  assert.deepEqual((await loadBrands()).brands.map(({ id }) => id), ['bueno']);
});

test('logo PNG: valida firma y tamaño y se asigna a la marca', async (t) => {
  t.after(restore);
  await restore();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  await assert.rejects(() => saveBrandLogo('risawow', Buffer.from('no es png'.repeat(10))), { status: 400 });
  await assert.rejects(() => saveBrandLogo('risawow', Buffer.concat([png, Buffer.alloc(1024 * 1024)])), { status: 413 });
  await assert.rejects(() => saveBrandLogo('nada', png), { status: 404 });
  const brand = await saveBrandLogo('risawow', png);
  assert.equal(brand.logoPath, '.corte-data/brands/risawow.png');
  await rm(new URL('../.corte-data/brands/risawow.png', import.meta.url), { force: true });
});

test('posición del distintivo y hashtag de marca', () => {
  assert.equal(watermarkOverlay({ watermarkPosition: 'top-center' }, { top: '12' }), 'x=(W-w)/2:y=12');
  assert.equal(watermarkOverlay({ watermarkPosition: 'top-right' }, { top: 'H*7/120' }), 'x=W-w-36:y=H*7/120');
  assert.match(watermarkOverlay({ watermarkPosition: 'bottom-center' }), /y=H-h-H\*0\.22/);
  assert.equal(brandTag({ name: 'Cocina Rápida!' }), 'cocinarapida');
});

test('rutas /api/brands: CRUD con comprobación de origen y validación', async (t) => {
  t.after(restore);
  await restore();
  const listed = await call('GET', '/api/brands');
  assert.equal(listed.status, 200);
  assert.equal(listed.payload.brands[0].handle, '@RisaWOW');
  const created = await call('POST', '/api/brands', { body: { brand: { id: 'canal-dos', name: 'Canal Dos', handle: '@canaldos' } } });
  assert.equal(created.payload.brand.handle, '@canaldos');
  await assert.rejects(() => call('POST', '/api/brands', { body: { id: 'x1', name: 'x' }, headers: { origin: 'http://evil.example' } }), { status: 403 });
  await assert.rejects(() => call('POST', '/api/brands', { body: { id: 'mal id', name: 'x' } }), { status: 400 });
  await assert.rejects(() => call('POST', '/api/brands', { body: '{}', headers: { 'content-type': 'text/plain' } }), { status: 400 });
  assert.equal((await call('DELETE', '/api/brands/canal-dos')).payload.deleted, 'canal-dos');
  await assert.rejects(() => call('DELETE', '/api/brands/canal-dos', { headers: { origin: 'http://evil.example' } }), { status: 403 });
  assert.equal((await call('GET', '/api/otra-cosa')).handled, false);
});

test('cada marca redacta su SEO con su nombre y tono y renderiza con su propio distintivo', async (t) => {
  t.after(restore);
  await restore();
  const { mkdtemp, readdir: list } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const { dataDir, getMediaTools, probeVideo, renderClip } = await import('../pipeline/media.mjs');
  const { analyzeAndSaveClipSeo } = await import('../pipeline/publication.mjs');
  const cocina = await saveBrand({ id: 'cocina', name: 'Cocina Rápida', handle: '@cocinarapida', showWatermark: true, seoVoice: 'chef cercano que explica paso a paso', defaultHashtags: ['#recetas'] });
  const sinMarca = await saveBrand({ id: 'sin-marca', name: 'Canal Limpio', handle: '', showWatermark: false, seoVoice: 'tono sobrio y técnico' });
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prompts = [];
  const infer = async ({ system }) => { prompts.push(system); return { ideas: [] }; };
  const transcript = { language: 'es', segments: [{ id: 1, start: 0.2, end: 1.8, text: 'Así se prepara la receta.', words: [] }] };
  const clip = { file: 'clip-1.mp4', title: 'La receta', start: 0, end: 2.4 };
  const first = await analyzeAndSaveClipSeo(infer, directory, 'Cocina', transcript, clip, 1, { brand: cocina, force: true });
  await analyzeAndSaveClipSeo(infer, directory, 'Cocina', transcript, { ...clip, file: 'clip-2.mp4' }, 2, { brand: sinMarca, force: true });
  assert.match(prompts[0], /copywriter para Cocina Rápida\. Voz de la marca: chef cercano/);
  assert.match(prompts[1], /copywriter para Canal Limpio\. Voz de la marca: tono sobrio/);
  assert.ok(prompts.every((prompt) => !prompt.includes('RisaWOW')), 'ningún prompt nombra una marca fija');
  assert.ok(first.platforms.youtube.hashtags.includes('#recetas') || first.platforms.tiktok.hashtags.includes('#recetas'), 'usa los hashtags de la marca');

  const { ffmpeg } = await getMediaTools();
  const source = join(directory, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30:d=2.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.4', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
  const { normalizeFormat } = await import('../pipeline/formats.mjs');
  const format = normalizeFormat({ ratio: '9:16', layouts: ['fit'], fitCrop: 'original' });
  const plan = { layout: 'fit', mode: 'fit', regions: [{ x: 0.5, y: 0.5, width: 1, height: 1 }] };
  for (const [number, brand] of [[1, cocina], [2, sinMarca]]) {
    const file = await renderClip(source, directory, clip, transcript, plan, number, format, { aspect: 16 / 9, brand });
    assert.equal(file, `clip-${number}.mp4`);
    assert.ok((await probeVideo(join(directory, file))).duration > 2);
  }
  assert.ok((await list(directory)).includes('clip-2.mp4'));
});
