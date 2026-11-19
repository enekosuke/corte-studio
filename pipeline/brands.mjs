import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RequestError } from './errors.mjs';
import { fileURLToPath } from 'node:url';
import { renameWithRetry } from './fsx.mjs';
import { projectRoot } from './runtime.mjs';

const dataDir = fileURLToPath(new URL('../.corte-data/', import.meta.url));

// Perfiles de marca: handle, logo, tono SEO y estilo. Se guardan en .corte-data/brands.json.

export const brandsFile = process.env.CORTE_BRANDS_FILE || join(dataDir, 'brands.json');
export const brandLogosDir = join(dataDir, 'brands');
export const subtitlePresets = ['hormozi-pop', 'gaming-neon', 'editorial-clean', 'podcast-speaker', 'classic-karaoke'];
export const watermarkPositions = ['top-center', 'top-left', 'top-right', 'bottom-center'];
const idPattern = /^[a-z0-9][a-z0-9-]{1,39}$/;
const tagPattern = /^#?[\p{L}\p{N}_]{2,32}$/u;
const defaultLogo = 'dist/assets/watermark.png';

export const genericBrand = Object.freeze({
  id: 'default',
  name: 'Mi canal',
  handle: '',
  logoPath: defaultLogo,
  showWatermark: false,
  watermarkPosition: 'top-center',
  subtitlePreset: 'classic-karaoke',
  accentHex: '#FFE600',
  seoVoice: 'creador hispanohablante con ritmo rápido y tono cercano',
  defaultHashtags: [],
  linkedYouTubeChannelId: '',
  bgmFolder: '',
  bgmVolumeDb: -18,
  bleepProfanity: true,
  sfx: true,
});

let cached = { mtime: 0, key: '', value: null };
let writing = Promise.resolve();

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Valida y normaliza una marca. Lanza 400 con un mensaje concreto si algo no es válido. */
export function normalizeBrand(input, { partial = false, base = genericBrand } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'La marca debe ser un objeto JSON.');
  const merged = { ...base, ...(partial ? input : { ...genericBrand, ...input }) };
  const id = typeof merged.id === 'string' ? merged.id.trim().toLowerCase() : '';
  if (!idPattern.test(id)) throw new RequestError(400, 'El identificador de la marca debe tener 2 a 40 caracteres: letras minúsculas, números y guiones.');
  const name = text(merged.name, 60);
  if (!name) throw new RequestError(400, 'La marca necesita un nombre.');
  const rawHandle = text(merged.handle, 40).replace(/^@+/, '');
  if (rawHandle && !/^[\w.\-]{1,39}$/.test(rawHandle)) throw new RequestError(400, 'El @handle solo puede llevar letras, números, puntos, guiones y guiones bajos.');
  const accentHex = typeof merged.accentHex === 'string' ? merged.accentHex.trim() : '';
  if (!/^#[0-9a-f]{6}$/i.test(accentHex)) throw new RequestError(400, 'El color de acento debe ser un hexadecimal como #FFE600.');
  const subtitlePreset = subtitlePresets.includes(merged.subtitlePreset) ? merged.subtitlePreset : null;
  if (!subtitlePreset) throw new RequestError(400, `El estilo de subtítulos debe ser uno de: ${subtitlePresets.join(', ')}.`);
  const watermarkPosition = watermarkPositions.includes(merged.watermarkPosition) ? merged.watermarkPosition : null;
  if (!watermarkPosition) throw new RequestError(400, `La posición de la marca de agua debe ser una de: ${watermarkPositions.join(', ')}.`);
  const tags = Array.isArray(merged.defaultHashtags) ? merged.defaultHashtags : [];
  if (tags.length > 8 || tags.some((tag) => typeof tag !== 'string' || !tagPattern.test(tag.trim()))) {
    throw new RequestError(400, 'Los hashtags por defecto son como mucho 8 y deben ser válidos.');
  }
  const volume = Number(merged.bgmVolumeDb);
  if (!Number.isFinite(volume) || volume < -40 || volume > 0) throw new RequestError(400, 'El volumen de la música debe estar entre -40 y 0 dB.');
  const logoPath = text(merged.logoPath, 200) || defaultLogo;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(logoPath) || /^(?:[a-z]:|[\\/])/i.test(logoPath) || !/\.png$/i.test(logoPath)) {
    throw new RequestError(400, 'El logo debe ser un PNG dentro del proyecto o de .corte-data/brands.');
  }
  const channel = text(merged.linkedYouTubeChannelId, 40);
  if (channel && !/^[\w-]+$/.test(channel)) throw new RequestError(400, 'El identificador del canal de YouTube no es válido.');
  const bgmFolder = text(merged.bgmFolder, 200);
  if (/(^|[\\/])\.\.([\\/]|$)/.test(bgmFolder) || /^(?:[a-z]:|[\\/])/i.test(bgmFolder)) throw new RequestError(400, 'La carpeta de música debe ser una ruta relativa al proyecto.');
  return {
    id, name, handle: rawHandle ? `@${rawHandle}` : '', logoPath,
    showWatermark: Boolean(merged.showWatermark) && Boolean(rawHandle), watermarkPosition, subtitlePreset,
    accentHex: accentHex.toUpperCase(), seoVoice: text(merged.seoVoice, 200) || genericBrand.seoVoice,
    defaultHashtags: [...new Set(tags.map((tag) => `#${tag.trim().replace(/^#/, '')}`))],
    linkedYouTubeChannelId: channel, bgmFolder, bgmVolumeDb: volume,
    bleepProfanity: merged.bleepProfanity !== false, sfx: merged.sfx !== false,
  };
}

async function readFileState() {
  try {
    const raw = await readFile(brandsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { raw, parsed };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Carga el archivo con valores por defecto: un archivo ausente o dañado equivale a la marca genérica. */
export async function loadBrands() {
  const state = await readFileState();
  const key = state?.raw ?? '';
  if (cached.value && cached.key === key) return cached.value;
  const brands = [];
  for (const entry of Array.isArray(state?.parsed?.brands) ? state.parsed.brands : []) {
    try {
      const brand = normalizeBrand(entry);
      if (!brands.some(({ id }) => id === brand.id)) brands.push(brand);
    } catch { /* Una marca inválida se ignora sin tumbar el estudio. */ }
  }
  if (!brands.length) brands.push({ ...genericBrand });
  const requested = state?.parsed?.defaultBrandId;
  const defaultBrandId = brands.some(({ id }) => id === requested) ? requested : brands[0].id;
  cached = { mtime: 0, key, value: { defaultBrandId, brands } };
  return cached.value;
}

async function persist(value) {
  const run = async () => {
    await mkdir(dirname(brandsFile), { recursive: true });
    const staging = `${brandsFile}.${process.pid}.tmp`;
    try {
      await writeFile(staging, JSON.stringify(value, null, 2), 'utf8');
      await renameWithRetry(staging, brandsFile);
    } finally {
      await rm(staging, { force: true }).catch(() => {});
    }
    cached = { mtime: 0, key: '', value: null };
  };
  const next = writing.then(run, run);
  writing = next.catch(() => {});
  return next;
}

/** Marca por id; si no existe o no se indica, la marca por defecto. */
export async function getBrand(id) {
  const { defaultBrandId, brands } = await loadBrands();
  return brands.find((brand) => brand.id === id) ?? brands.find((brand) => brand.id === defaultBrandId) ?? brands[0];
}

export async function saveBrand(input, { makeDefault = false } = {}) {
  const current = await loadBrands();
  const existing = current.brands.find(({ id }) => id === String(input?.id ?? '').trim().toLowerCase());
  const brand = normalizeBrand(input, { partial: Boolean(existing), base: existing ?? genericBrand });
  const brands = existing ? current.brands.map((entry) => (entry.id === brand.id ? brand : entry)) : [...current.brands, brand];
  if (brands.length > 40) throw new RequestError(400, 'Hay demasiadas marcas. Elimina alguna antes de crear otra.');
  await persist({ defaultBrandId: makeDefault ? brand.id : current.defaultBrandId, brands });
  return brand;
}

export async function deleteBrand(id) {
  const current = await loadBrands();
  if (!current.brands.some((brand) => brand.id === id)) throw new RequestError(404, 'Esa marca no existe.');
  if (current.brands.length === 1) throw new RequestError(409, 'No se puede eliminar la única marca. Crea otra antes.');
  const brands = current.brands.filter((brand) => brand.id !== id);
  const defaultBrandId = current.defaultBrandId === id ? brands[0].id : current.defaultBrandId;
  await persist({ defaultBrandId, brands });
  return { deleted: id, defaultBrandId };
}

/** Guarda un logo PNG (máx. 1 MB) y lo asigna a la marca. */
export async function saveBrandLogo(id, data) {
  const current = await loadBrands();
  const brand = current.brands.find((entry) => entry.id === id);
  if (!brand) throw new RequestError(404, 'Esa marca no existe.');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(data) || data.length < 33 || !data.subarray(0, 8).equals(signature)) throw new RequestError(400, 'El logo debe ser un archivo PNG válido.');
  if (data.length > 1024 * 1024) throw new RequestError(413, 'El logo no puede superar 1 MB.');
  await mkdir(brandLogosDir, { recursive: true });
  const target = join(brandLogosDir, `${id}.png`);
  const staging = `${target}.${process.pid}.tmp`;
  await writeFile(staging, data);
  await renameWithRetry(staging, target);
  return saveBrand({ id, logoPath: `.corte-data/brands/${id}.png` });
}

/** Ruta absoluta del logo de una marca; cae en el logo incluido si el archivo falta. */
export async function brandLogoFile(brand) {
  const path = join(projectRoot, brand.logoPath);
  const fallback = join(projectRoot, defaultLogo);
  return access(path).then(() => path, () => fallback);
}

/** Posición del distintivo de marca como expresiones de overlay de FFmpeg. */
export function watermarkOverlay(brand, { top = '12' } = {}) {
  const [vertical, horizontal] = brand.watermarkPosition.split('-');
  const x = horizontal === 'left' ? '36' : horizontal === 'right' ? 'W-w-36' : '(W-w)/2';
  const y = vertical === 'bottom' ? 'H-h-H*0.22' : top;
  return `x=${x}:y=${y}`;
}

/** Hashtag semilla a partir del nombre de la marca ("RisaWOW" -> "risawow"). */
export function brandTag(brand) {
  return brand.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase().slice(0, 30);
}
