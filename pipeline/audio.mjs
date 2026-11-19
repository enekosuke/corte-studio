import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normWord } from './clipfx.mjs';
import { projectRoot } from './runtime.mjs';

// Diseño sonoro del clip: censura bleep, efectos (whoosh, pop, hit), música de fondo con ducking y sonoridad final.

export const sfxNames = ['whoosh', 'pop', 'riser', 'hit', 'bleep', 'record_scratch'];
export const sfxPath = (name) => fileURLToPath(new URL(`./assets/sfx/${name}.ogg`, import.meta.url));
const bgmExtensions = new Set(['.ogg', '.mp3', '.wav', '.m4a', '.flac', '.opus']);

// Palabrotas habituales en español. Se comparan sin tildes ni mayúsculas. «coño» se mira aparte porque sin tilde
// ("cono") es una palabra normal.
const profanity = [
  /^jod(?:er|ido|ida|idos|idas|e|en|es|iendo|ete|eros?|ienda)$/, /^mierd(?:a|as|oso|osa)$/, /^cabron(?:a|es|as|azo)?$/, /^gilipoll(?:as|a|ez)$/,
  /^put(?:a|as|o|os|ada|adas)$/, /^hostia(?:s)?$/, /^cojon(?:es|udo|udos)$/, /^poll(?:a|as)$/, /^pendej(?:o|a|os|as)$/, /^carajo$/, /^verga(?:s)?$/,
  /^hijoputa(?:s)?$/, /^joputa(?:s)?$/, /^capull(?:o|os|a)$/, /^maric(?:on|ones)$/, /^follar$/, /^follad(?:o|a|os|as)$/, /^culo(?:s)?$/, /^chinga(?:r|da|do)?$/,
];

export const isProfane = (text) => {
  const raw = String(text ?? '').toLowerCase().replace(/[^\p{L}]/gu, '');
  if (raw === 'coño' || raw === 'coños') return true;
  const word = normWord(text);
  return word.length >= 3 && profanity.some((pattern) => pattern.test(word));
};

/** "joder" -> "j***r": se conserva la primera y la última letra. */
export const censorText = (text) => String(text).replace(/\p{L}[\p{L}\p{N}]*/gu, (word) => (isProfane(word)
  ? (word.length <= 3 ? `${word[0]}${'*'.repeat(word.length - 1)}` : `${word[0]}${'*'.repeat(word.length - 2)}${word.at(-1)}`)
  : word));

/** Rangos (en tiempo del clip montado) donde hay palabrotas, con un margen y fusionando los solapados. */
export function profanityRanges(words, clip, timeline = null, { pad = 0.04 } = {}) {
  const ranges = [];
  for (const word of words) {
    if (!isProfane(word.text) || word.end <= clip.start || word.start >= clip.end) continue;
    let start = word.start - clip.start;
    let end = word.end - clip.start;
    if (timeline) {
      const part = timeline.parts.find((candidate) => !candidate.cold && word.start >= candidate.start - 1e-6 && word.end <= candidate.end + 0.05);
      if (!part) continue;
      start = part.outStart + (word.start - part.start);
      end = part.outStart + (word.end - part.start);
    }
    ranges.push({ start: Math.max(0, start - pad), end: end + pad });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    if (merged.length && range.start <= merged.at(-1).end + 0.05) merged.at(-1).end = Math.max(merged.at(-1).end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(({ start, end }) => ({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) }));
}

/** Pista de música de la marca para un clip: se reparte por número de clip entre los archivos de su carpeta. */
export async function pickBgm(brand, clipNumber) {
  if (!brand?.bgmFolder) return null;
  const folder = join(projectRoot, brand.bgmFolder);
  const files = (await readdir(folder).catch(() => [])).filter((name) => bgmExtensions.has(extname(name).toLowerCase())).sort();
  if (!files.length) return null;
  return { path: join(folder, files[(Math.max(1, clipNumber) - 1) % files.length]), volumeDb: Number.isFinite(brand.bgmVolumeDb) ? brand.bgmVolumeDb : -18 };
}

/** Efectos del clip, en tiempo del clip montado: whoosh al arrancar, pop al aparecer el rótulo y golpes en los picos. */
export function planSfxEvents({ hasHook = false, cold = false, punches = [] } = {}) {
  const events = [{ name: 'whoosh', at: 0, volume: cold ? 0.7 : 0.45 }];
  if (hasHook) events.push({ name: 'pop', at: cold ? 1.6 : 0.08, volume: 0.4 });
  for (const time of punches.slice(0, 3)) events.push({ name: 'hit', at: time, volume: 0.3 });
  return events;
}

const seconds = (value) => Math.max(0, value).toFixed(3);
const between = (ranges) => ranges.map(({ start, end }) => `between(t,${seconds(start)},${seconds(end)})`).join('+');

/**
 * Grafo de audio del clip. Parte de [voice0] (la voz ya recortada o la del origen) y termina en [aout].
 * Orden: censura -> música con ducking (y silencio antes del clímax) -> efectos -> sonoridad final.
 * `firstInput` es el índice de entrada de FFmpeg de la primera entrada extra; `inputs` son los argumentos -i correspondientes.
 */
export const VOICE_POLISH_CHAIN = 'highpass=f=80,afftdn=nf=-25,dynaudnorm=f=150:g=15:p=0.9,equalizer=f=3200:t=q:w=1.5:g=2.5';

export function buildAudioGraph({ duration, bleeps = [], bgm = null, climaxAt = null, sfx = [], firstInput = 2, loudness = 'loudnorm=I=-16:TP=-1.5:LRA=11', voiceLabel = 'voice0', voicePolish = false }) {
  const graph = [];
  const inputs = [];
  let next = firstInput;
  let voice = voiceLabel;
  if (voicePolish) {
    graph.push(`[${voice}]${VOICE_POLISH_CHAIN}[voice_polished]`);
    voice = 'voice_polished';
  }
  if (bleeps.length) {
    const active = between(bleeps);
    graph.push(`[${voice}]volume='1-gt(${active},0)':eval=frame[voice_muted]`);
    graph.push(`aevalsrc='0.3*sin(2*PI*1000*t)*gt(${active},0)':s=48000:d=${seconds(duration)},aformat=channel_layouts=stereo[bleep]`);
    graph.push('[voice_muted][bleep]amix=inputs=2:duration=first:normalize=0[voice_bleeped]');
    voice = 'voice_bleeped';
  }
  let mixed = voice;
  if (bgm) {
    inputs.push('-stream_loop', '-1', '-i', bgm.path);
    const input = next++;
    const climax = Number.isFinite(climaxAt) && climaxAt > 1 ? `,volume='1-between(t,${seconds(climaxAt - 0.35)},${seconds(climaxAt)})':eval=frame` : '';
    graph.push(`[${voice}]asplit=2[vmix][vside]`);
    graph.push(`[${input}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${seconds(duration)},highpass=f=80,volume=${bgm.volumeDb}dB${climax}[bgm0]`);
    graph.push('[bgm0][vside]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=350[bgm_ducked]');
    graph.push('[vmix][bgm_ducked]amix=inputs=2:duration=first:normalize=0[with_bgm]');
    mixed = 'with_bgm';
  }
  if (sfx.length) {
    const labels = [];
    sfx.forEach((event, index) => {
      inputs.push('-i', sfxPath(event.name));
      const input = next++;
      const delay = Math.round(event.at * 1000);
      graph.push(`[${input}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${event.volume},adelay=${delay}|${delay}[sfx${index}]`);
      labels.push(`[sfx${index}]`);
    });
    graph.push(`[${mixed}]${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:normalize=0[with_sfx]`);
    mixed = 'with_sfx';
  }
  graph.push(`[${mixed}]${loudness}[aout]`);
  return { graph: graph.join(';'), inputs, usedInputs: next - firstInput };
}
