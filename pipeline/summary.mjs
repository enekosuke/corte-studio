import { editorWindows } from './analysis.mjs';
import { RequestError } from './errors.mjs';
import { summaryBeatSchema, summaryBeatSystem, summaryDirectorSchema, summaryDirectorSystem } from './prompts.mjs';

// Modo Resumen: condensa un vídeo largo en una versión más corta que conserva lo importante.
// Flujo: 1) pasajes por ventana (map) 2) dirección global (reduce) 3) ajuste determinista al
// presupuesto de tiempo 4) cortes en pausas naturales sin aire muerto 5) capítulos y tarjetas.

export const SUMMARY_FPS = 30;
export const SUMMARY_VERSION = 2;
export const SUMMARY_TIMING = {
  lead: 0.2, // aire antes de la primera palabra de un tramo
  tail: 0.38, // aire tras la última palabra, para no comerse la cola de la frase
  maxGap: 1.4, // pausas internas mayores se recortan
  joinGap: 1.6, // pasajes separados por menos que esto se unen sin corte
  minPart: 0.6,
};
export const SUMMARY_CARDS = {
  introSeconds: 4,
  seconds: 3.4,
  minGapSeconds: 90, // entre tarjetas de capítulo
  forceAfterSeconds: 300, // si pasan 5 min sin tarjeta, la siguiente transición lleva una
  minPartSeconds: 5,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const frameSnap = (seconds) => Math.round(seconds * SUMMARY_FPS) / SUMMARY_FPS;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const cleanText = (value, max) => {
  const text = String(value ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  // Se corta en el último límite de palabra para no dejar palabras a medias.
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–]+$/, '');
};

export function resolveSummaryTarget(duration, requestedMinutes) {
  const requested = number(requestedMinutes) > 0 ? number(requestedMinutes) * 60 : clamp(duration * 0.25, 180, 1800);
  const target = Math.round(Math.min(requested, duration * 0.7));
  if (!Number.isFinite(target) || target < 45) {
    throw new RequestError(400, 'El vídeo es demasiado corto para resumirlo. Usa el modo de vídeos normales.');
  }
  return target;
}

/** Convierte un rango de segmentos en tramos de origen, quitando el aire muerto interno. */
export function buildRangeParts(segments, i0, i1, mediaDuration, timing = SUMMARY_TIMING) {
  const parts = [];
  const before = i0 > 0 ? segments[i0].start - segments[i0 - 1].end : Infinity;
  const after = i1 < segments.length - 1 ? segments[i1 + 1].start - segments[i1].end : Infinity;
  let start = Math.max(0, segments[i0].start - Math.min(timing.lead, Math.max(0.03, before / 2)));
  for (let index = i0; index < i1; index++) {
    const gap = segments[index + 1].start - segments[index].end;
    if (gap <= timing.maxGap) continue;
    const end = segments[index].end + Math.min(timing.tail, gap / 2);
    parts.push([start, end]);
    start = segments[index + 1].start - Math.min(timing.lead, gap / 2);
  }
  const lastEnd = Math.min(mediaDuration, segments[i1].end + Math.min(timing.tail, Math.max(0.05, after / 2)));
  parts.push([start, lastEnd]);
  return parts
    .map(([from, to]) => {
      const a = Math.floor(Math.max(0, from) * SUMMARY_FPS) / SUMMARY_FPS;
      const b = Math.min(mediaDuration, to);
      const duration = Math.max(1 / SUMMARY_FPS, frameSnap(b - a));
      return { start: a, end: Number((a + duration).toFixed(4)), duration };
    })
    .filter((part) => part.duration >= timing.minPart);
}

function energyStats(segments, i0, i1) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let index = i0; index <= i1; index++) {
    const energy = segments[index].energy;
    if (!Number.isFinite(energy)) continue;
    peak = Math.max(peak, energy);
    sum += energy;
    count++;
  }
  return { peak, mean: count ? sum / count : 0 };
}

const beatKinds = new Set(['gancho', 'dato_clave', 'historia', 'conflicto', 'humor', 'reaccion', 'explicacion', 'remate', 'contexto']);

/** Valida y puntúa los pasajes que devuelve el modelo para una ventana. */
export function normalizeBeats(raw, segments, indexById, mediaDuration) {
  const beats = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    let i0 = indexById.get(item?.startSegmentId);
    let i1 = indexById.get(item?.endSegmentId);
    if (i0 === undefined || i1 === undefined) continue;
    if (i1 < i0) [i0, i1] = [i1, i0];
    const length = segments[i1].end - segments[i0].start;
    if (length < 3 || length > 240) continue;
    const importance = clamp(number(item.importance), 0, 10);
    const appeal = clamp(number(item.appeal), 0, 10);
    const { peak, mean } = energyStats(segments, i0, i1);
    const chat = Math.max(0, ...segments.slice(i0, i1 + 1).map(({ chatSpike }) => (Number.isFinite(chatSpike) ? chatSpike : 0)));
    const energyBoost = Math.max(peak ? ((peak * 0.6 + mean * 0.4) - 1) / 9 * 10 : 5, chat);
    const value = Number((importance * 0.6 + appeal * 0.25 + clamp(energyBoost, 0, 10) * 0.15).toFixed(2));
    const parts = buildRangeParts(segments, i0, i1, mediaDuration);
    beats.push({
      i0, i1, start: segments[i0].start, end: segments[i1].end, importance, appeal, value,
      kind: beatKinds.has(item.kind) ? item.kind : 'explicacion',
      topic: cleanText(item.topic, 60), summary: cleanText(item.summary, 180),
      effective: parts.reduce((total, part) => total + part.duration, 0),
    });
  }
  return beats;
}

/** Elimina pasajes repetidos entre ventanas que se solapan, conservando el de más valor. */
export function dedupeBeats(beats, limit = 160) {
  const accepted = [];
  for (const beat of [...beats].sort((a, b) => b.value - a.value)) {
    const clash = accepted.some((other) => {
      const overlap = Math.min(beat.end, other.end) - Math.max(beat.start, other.start);
      return overlap > 0.4 * Math.min(beat.end - beat.start, other.end - other.start);
    });
    if (!clash) accepted.push(beat);
    if (accepted.length >= limit) break;
  }
  return accepted.sort((a, b) => a.start - b.start).map((beat, index) => ({ ...beat, id: index + 1 }));
}

/** Une pasajes elegidos en rangos continuos y calcula sus tramos finales. */
export function assemble(chosen, segments, mediaDuration, timing = SUMMARY_TIMING) {
  const ordered = [...chosen].sort((a, b) => a.i0 - b.i0);
  const ranges = [];
  for (const beat of ordered) {
    const last = ranges.at(-1);
    if (last && (beat.i0 <= last.i1 + 1 || segments[beat.i0].start - segments[last.i1].end <= timing.joinGap)) {
      last.i1 = Math.max(last.i1, beat.i1);
      last.beats.push(beat);
    } else {
      ranges.push({ i0: beat.i0, i1: beat.i1, beats: [beat] });
    }
  }
  let offset = 0;
  for (const range of ranges) {
    range.parts = buildRangeParts(segments, range.i0, range.i1, mediaDuration, timing);
    for (const part of range.parts) {
      part.outStart = Number(offset.toFixed(4));
      offset += part.duration;
    }
  }
  return { ranges, total: offset };
}

/** Ajusta la selección al tiempo objetivo: rellena con lo más valioso y recorta lo menos valioso. */
export function fitBudget(beats, target, segments, mediaDuration, preferred = []) {
  const byId = new Map(beats.map((beat) => [beat.id, beat]));
  const chosen = new Set(preferred.filter((id) => byId.has(id)));
  const total = () => assemble([...chosen].map((id) => byId.get(id)), segments, mediaDuration).total;
  const high = target * 1.05;
  const low = target * 0.97;
  let current = total();
  while (current > high && chosen.size > 2) {
    const weakest = [...chosen].map((id) => byId.get(id))
      .sort((a, b) => a.value / Math.max(8, a.effective) - b.value / Math.max(8, b.effective) || a.value - b.value)[0];
    chosen.delete(weakest.id);
    current = total();
  }
  // Primero solo pasajes sólidos; si aun así se queda corto, se admiten los medianos antes que dejar el resumen a medias.
  for (const minimum of [4, 3]) {
    if (minimum === 3 && current >= target * 0.85) break;
    const pool = beats.filter((beat) => beat.value >= minimum).sort((a, b) => b.value - a.value);
    let progress = true;
    while (current < low && progress) {
      progress = false;
      for (const beat of pool) {
        if (chosen.has(beat.id)) continue;
        chosen.add(beat.id);
        const next = total();
        if (next <= high) {
          current = next;
          progress = true;
          break;
        }
        chosen.delete(beat.id);
      }
    }
  }
  return [...chosen].map((id) => byId.get(id)).sort((a, b) => a.i0 - b.i0);
}

const normalizeTitle = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Planifica capítulos y tarjetas de contexto sobre la línea de tiempo del resumen. */
export function planChapters(ranges, directions, { intro = '', total }) {
  const items = ranges.map((range, index) => {
    const first = range.beats[0];
    const direction = directions.get(first.id) ?? {};
    return {
      index,
      outStart: range.parts[0]?.outStart ?? 0,
      title: cleanText(direction.chapter || first.topic || `Parte ${index + 1}`, 60),
      card: cleanText(direction.card || '', 72),
      fallbackCard: cleanText(first.summary, 72),
    };
  }).filter((item) => ranges[item.index].parts.length);
  const chapters = [];
  for (const item of items) {
    const previous = chapters.at(-1);
    if (previous && normalizeTitle(previous.title) === normalizeTitle(item.title)) continue;
    chapters.push({ title: item.title, outStart: item.outStart, card: item.card, rangeIndex: item.index });
  }
  // Pocos capítulos y con sentido: se funde siempre el más corto con el anterior hasta cumplir el máximo y la duración mínima.
  const merged = [...chapters];
  if (merged.length) merged[0].outStart = 0;
  const maxChapters = clamp(Math.round(total / 90), 3, 12);
  const minLength = Math.max(25, Math.min(60, total / 20));
  const lengthOf = (index) => (merged[index + 1]?.outStart ?? total) - merged[index].outStart;
  while (merged.length > 1) {
    let shortest = 1;
    for (let index = 1; index < merged.length; index++) {
      if (lengthOf(index) < lengthOf(shortest)) shortest = index;
    }
    if (merged.length <= maxChapters && lengthOf(shortest) >= minLength) break;
    merged.splice(shortest, 1);
  }
  const cards = [];
  const cardAt = (range, text, kind, seconds) => {
    const part = range.parts.find((candidate) => candidate.duration >= SUMMARY_CARDS.minPartSeconds);
    if (!part || !text) return;
    cards.push({ part, text, kind, seconds: Math.min(seconds, part.duration - 1.2) });
  };
  if (cleanText(intro, 96) && ranges.length) cardAt(ranges[0], cleanText(intro, 96), 'intro', SUMMARY_CARDS.introSeconds);
  let lastCardAt = cards.length ? 0 : -Infinity;
  const chapterByRange = new Map(merged.map((chapter) => [chapter.rangeIndex, chapter]));
  for (const item of items.slice(1)) {
    const chapter = chapterByRange.get(item.index);
    const sinceLast = item.outStart - lastCardAt;
    const text = item.card || (sinceLast >= SUMMARY_CARDS.forceAfterSeconds ? item.fallbackCard : '');
    const due = chapter ? sinceLast >= SUMMARY_CARDS.minGapSeconds : sinceLast >= SUMMARY_CARDS.forceAfterSeconds;
    if (!text || !due) continue;
    const before = cards.length;
    cardAt(ranges[item.index], text, chapter ? 'chapter' : 'cut', SUMMARY_CARDS.seconds);
    if (cards.length > before) lastCardAt = item.outStart;
  }
  const numbered = merged.length >= 3;
  for (const card of cards) {
    const number = numbered && card.kind === 'chapter' ? merged.findIndex((chapter) => chapter.outStart === card.part.outStart) + 1 : 0;
    card.part.card = { text: card.text, kind: card.kind, seconds: Number(card.seconds.toFixed(2)), ...(number > 0 ? { number } : {}) };
  }
  return { chapters: merged.length >= 3 ? merged.map(({ title, outStart }) => ({ title, outStart })) : [], cardCount: cards.length };
}

/** Plan completo de resumen: lista de tramos, capítulos, tarjetas y metadatos de publicación. */
export async function planSummary(infer, transcript, media, progress, { target, sourceTitle = '', sourceChannel, local = false } = {}) {
  const segments = transcript.segments;
  if (!segments.length) throw new RequestError(409, 'El vídeo no tiene voz que resumir.');
  const indexById = new Map(segments.map((segment, index) => [segment.id, index]));
  const windows = editorWindows(segments, local);
  const found = [];
  for (const [index, window] of windows.entries()) {
    await progress(`Buscando lo importante (${index + 1} de ${windows.length})…`);
    const compact = window.map(({ id, start, end, text, energy, wps, pauseBefore, chatSpike }) => ({
      id, start, end, text,
      ...(Number.isFinite(energy) ? { energy } : {}),
      ...(Number.isFinite(chatSpike) ? { chatSpike } : {}),
      ...(Number.isFinite(wps) ? { wps } : {}),
      ...(Number.isFinite(pauseBefore) && pauseBefore >= 0.6 ? { pauseBefore } : {}),
    }));
    const result = await infer({
      system: summaryBeatSystem, schema: summaryBeatSchema, maxOutputTokens: 8192,
      parts: [{ text: JSON.stringify({
        ...(sourceTitle ? { sourceTitle } : {}), ...(sourceChannel ? { sourceChannel } : {}),
        language: transcript.language, videoDuration: media.duration, segments: compact,
      }) }],
    });
    if (!Array.isArray(result?.beats)) throw new RequestError(502, 'El modelo no devolvió pasajes válidos para el resumen.');
    found.push(...normalizeBeats(result.beats, segments, indexById, media.duration));
  }
  const beats = dedupeBeats(found);
  if (!beats.length) throw new RequestError(502, 'El modelo no encontró pasajes que merezcan entrar en el resumen.');

  await progress('Dirigiendo el montaje: qué entra, en qué orden y con qué capítulos…');
  let direction = null;
  try {
    direction = await infer({
      system: summaryDirectorSystem, schema: summaryDirectorSchema, maxOutputTokens: 6144,
      parts: [{ text: JSON.stringify({
        ...(sourceTitle ? { sourceTitle } : {}), language: transcript.language,
        targetSeconds: target, videoDuration: Math.round(media.duration),
        beats: beats.map(({ id, start, end, effective, kind, importance, appeal, value, topic, summary }) => ({
          id, start: Math.round(start), end: Math.round(end), duration: Math.round(effective), kind, importance, appeal, value, topic, summary,
        })),
      }) }],
    });
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error;
    console.warn('El director de montaje no respondió. Se usa la selección por valor:', error.message);
  }
  const directions = new Map();
  const preferred = [];
  for (const item of Array.isArray(direction?.selected) ? direction.selected : []) {
    if (Number.isInteger(item?.id) && beats.some(({ id }) => id === item.id) && !directions.has(item.id)) {
      directions.set(item.id, { chapter: item.chapter, card: item.card });
      preferred.push(item.id);
    }
  }

  await progress('Ajustando la duración y cortando en pausas naturales…');
  const chosen = fitBudget(beats, target, segments, media.duration, preferred);
  if (!chosen.length) throw new RequestError(502, 'No se pudo componer un resumen con los pasajes encontrados.');
  const { ranges, total } = assemble(chosen, segments, media.duration);
  const { chapters, cardCount } = planChapters(ranges, directions, { intro: direction?.intro, total });
  const parts = ranges.flatMap((range, rangeIndex) => range.parts.map((part) => ({ ...part, rangeIndex })));
  return {
    version: SUMMARY_VERSION,
    targetSeconds: target,
    outputSeconds: Number(total.toFixed(3)),
    sourceSeconds: Number(media.duration.toFixed(3)),
    beatCount: chosen.length,
    cardCount,
    title: cleanText(direction?.title, 90) || cleanText(sourceTitle, 90) || 'Resumen del vídeo',
    description: cleanText(direction?.description, 600),
    chapters,
    parts,
  };
}

export const formatTimestamp = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor(total / 60) % 60).padStart(hours ? 2 : 1, '0');
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
};

export const chapterListing = (chapters) => chapters.map(({ title, outStart }) => `${formatTimestamp(outStart)} ${title}`).join('\n');
