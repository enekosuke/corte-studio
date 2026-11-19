// Efectos de edición viral para clips cortos (lógica pura, sin FFmpeg): tiempos de palabras, silencios, apertura con
// adelanto del pico, zoom con temblor en picos de energía y filtros de recorte/unión.

export const CLIP_FX = {
  fps: 30,
  minWord: 0.09, // duración mínima de una palabra en subtítulos (los tiempos brutos de Whisper derivan 50-150 ms)
  closeGap: 0.12, // los huecos menores se cierran para que el subtítulo no parpadee
  silenceThreshold: 0.45, // pausas mayores se recortan en clips de charla
  lead: 0.08, // aire antes de la primera palabra tras un corte
  tail: 0.12, // aire tras la última palabra antes de un corte
  endTail: 0.22, // cola final: se recorta el silencio de cierre para favorecer el bucle
  minPart: 0.4,
  coldOpenSeconds: 1.6,
  coldOpenMinGap: 3, // solo se adelanta el pico si el inicio natural tarda más de esto en llegar
  punchEnergy: 8,
  punchSpacing: 4,
  punchMax: 6,
  punchLeadIn: 0.8,
  punchZoom: 0.085,
  shakeSeconds: 0.22,
  phraseZoom: 0.09, // alternancia plano medio / primer plano en cada frase
  phraseSpacing: 3, // un cambio de plano como mucho cada 3 s
  coldZoom: 0.1,
  coldDip: 0.15, // oscurecimiento seco al final del adelanto, justo antes del arranque real
};

const frame = (seconds) => Math.round(seconds * CLIP_FX.fps) / CLIP_FX.fps;
const number = (value) => Number(value.toFixed(4));

export const normWord = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/** Conjunto normalizado de palabras clave a resaltar (máx. 12). */
export function highlightSet(list) {
  return new Set((Array.isArray(list) ? list : []).slice(0, 12).flatMap((entry) => String(entry).split(/\s+/)).map(normWord).filter((word) => word.length >= 2));
}

/** "#FFE600" -> "&H0000E6FF&" (formato BGR de ASS). */
export function hexToAss(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? '').trim());
  if (!match) return '&H0000EAFF&';
  const [, r, g, b] = match;
  return `&H00${`${b}${g}${r}`.toUpperCase()}&`;
}

/** Corrige los tiempos de palabra: duración mínima y cierre de micro-huecos, sin solapes. */
export function fixWordTimings(words, { minWord = CLIP_FX.minWord, closeGap = CLIP_FX.closeGap } = {}) {
  const sorted = words.map((word) => ({ ...word })).sort((a, b) => a.start - b.start);
  for (let index = 0; index < sorted.length; index++) {
    const word = sorted[index];
    const next = sorted[index + 1];
    if (next) {
      const gap = next.start - word.end;
      if (gap > 0 && gap < closeGap) word.end = next.start;
      if (word.end > next.start) word.end = next.start;
    }
    if (word.end - word.start < minWord) {
      word.end = word.start + minWord;
      if (next && word.end > next.start && next.start > word.start) word.end = next.start;
    }
    word.start = number(word.start);
    word.end = number(Math.max(word.end, word.start + 0.01));
  }
  return sorted;
}

/** Palabras con tiempo dentro de un rango (usa el segmento entero si Whisper no dio palabras). */
export function wordsInRange(transcript, start, end) {
  return (transcript?.segments ?? [])
    .filter((segment) => segment.end > start && segment.start < end)
    .flatMap((segment) => segment.words?.length ? segment.words : [{ start: segment.start, end: segment.end, text: segment.text }])
    .filter((word) => word.end > start && word.start < end && String(word.text ?? '').trim())
    .sort((a, b) => a.start - b.start);
}

/** Muletillas: sonidos de duda sueltos («eh», «mmm», «um») y arranques vacíos («bueno», «pues», «a ver») seguidos de pausa. */
const hesitation = /^(?:e+h+m*|e{2,}|h+m+|m{2,}|u+m+|u+h+|a+h+m+|e+m+)$/;
const openers = new Set(['bueno', 'pues', 'vale', 'nada', 'osea']);

export function isFiller(word, next = null) {
  const text = normWord(word.text);
  if (!text) return false;
  if (hesitation.test(text)) return true;
  return openers.has(text) && next !== null && next.start - word.end >= 0.25;
}

/** Tramos que quedan al quitar pausas largas y muletillas. Los tiempos son absolutos del vídeo fuente. */
export function planSilenceParts(words, clip, { threshold = CLIP_FX.silenceThreshold, lead = CLIP_FX.lead, tail = CLIP_FX.tail, endTail = CLIP_FX.endTail, fillers = true } = {}) {
  const inside = words.filter((word) => word.end > clip.start && word.start < clip.end);
  if (inside.length < 2) return [{ start: clip.start, end: clip.end }];
  // Se marcan las muletillas y se tratan como huecos: el corte cae justo antes y después de ellas.
  const removed = inside.map((word, index) => fillers && isFiller(word, inside[index + 1] ?? null) && word.end - word.start <= 1.2);
  const spoken = inside.filter((_, index) => !removed[index]);
  if (spoken.length < 1) return [{ start: clip.start, end: clip.end }];
  const hadFillerBetween = (from, to) => inside.some((word, index) => removed[index] && word.start >= from.end - 1e-6 && word.end <= to.start + 1e-6);
  const parts = [];
  let start = spoken[0].start - clip.start > 0.5 ? Math.max(clip.start, spoken[0].start - 0.15) : clip.start;
  for (let index = 0; index < spoken.length - 1; index++) {
    const gap = spoken[index + 1].start - spoken[index].end;
    if (gap <= threshold && !hadFillerBetween(spoken[index], spoken[index + 1])) continue;
    const room = Math.min(tail, gap / 2);
    parts.push({ start, end: spoken[index].end + room });
    start = spoken[index + 1].start - Math.min(lead, gap / 2);
  }
  const last = spoken.at(-1);
  parts.push({ start, end: clip.end - last.end > 0.3 ? Math.min(clip.end, last.end + endTail) : clip.end });
  const merged = [];
  for (const part of parts) {
    const snapped = { start: frame(Math.max(clip.start, part.start)), end: frame(Math.min(clip.end, part.end)) };
    if (snapped.end - snapped.start < CLIP_FX.minPart && merged.length) merged.at(-1).end = snapped.end;
    else if (snapped.end - snapped.start >= 1 / CLIP_FX.fps) merged.push(snapped);
  }
  return merged.length ? merged : [{ start: clip.start, end: clip.end }];
}

/** Fragmento del pico (flash-forward) que se antepone al clip, o null si el clip ya arranca fuerte. */
export function planColdOpen(clip, transcript, peakSegmentId, { seconds = CLIP_FX.coldOpenSeconds, minGap = CLIP_FX.coldOpenMinGap } = {}) {
  if (!Number.isInteger(peakSegmentId)) return null;
  const segment = (transcript?.segments ?? []).find(({ id }) => id === peakSegmentId);
  if (!segment || segment.start < clip.start || segment.start - clip.start < minGap) return null;
  const start = segment.words?.[0]?.start ?? segment.start;
  if (start >= clip.end - 1) return null;
  const limit = start + seconds;
  const boundary = (segment.words ?? []).filter((word) => word.end >= start + 1 && word.end <= limit + 0.4).at(-1)?.end;
  const end = Math.min(clip.end, boundary ?? limit);
  return end - start >= 0.8 ? { start: frame(start), end: frame(end) } : null;
}

/** Línea de tiempo del clip montado: tramos con su posición de salida. */
export function buildTimeline(clip, silenceParts, cold = null) {
  const parts = [...(cold ? [{ ...cold, cold: true }] : []), ...silenceParts];
  let offset = 0;
  const timeline = parts.map((part) => {
    const duration = Math.max(1 / CLIP_FX.fps, frame(part.end - part.start));
    const placed = { ...part, end: number(part.start + duration), duration, outStart: number(offset) };
    offset += duration;
    return placed;
  });
  const original = clip.end - clip.start;
  const mainTotal = silenceParts.reduce((sum, part) => sum + (part.end - part.start), 0);
  return { parts: timeline, total: number(offset), removed: number(Math.max(0, original - mainTotal)), cold: Boolean(cold) };
}

/** ¿Merece la pena montar con cortes? Solo si quita tiempo apreciable o añade el flash-forward. */
export const timelineChangesClip = (timeline) => timeline.cold || timeline.removed >= 0.35;

/** Tiempo del vídeo fuente -> tiempo del clip montado (prefiere el tramo principal sobre el flash-forward). */
export function mapTime(timeline, absolute) {
  const inside = (part) => absolute >= part.start - 1e-6 && absolute <= part.end + 1e-6;
  const part = timeline.parts.find((candidate) => !candidate.cold && inside(candidate)) ?? timeline.parts.find(inside);
  return part ? number(part.outStart + (absolute - part.start)) : null;
}

/** Subtítulos del clip montado: las palabras de cada tramo desplazadas a su posición de salida. */
export function timelineCues(timeline, makeCues) {
  return timeline.parts.flatMap((part) => makeCues({ start: part.start, end: part.end }).map((cue) => ({
    ...cue,
    start: number(cue.start + part.outStart),
    end: number(cue.end + part.outStart),
    tokens: cue.tokens?.map((token) => ({ ...token, start: number(token.start + part.outStart), end: number(token.end + part.outStart) })) ?? null,
  })));
}

/** Instantes (absolutos) de picos de energía donde dar un punch-in con temblor. */
export function punchTimes(audioSegments, clip, { minEnergy = CLIP_FX.punchEnergy, spacing = CLIP_FX.punchSpacing, max = CLIP_FX.punchMax, leadIn = CLIP_FX.punchLeadIn } = {}) {
  const candidates = (audioSegments ?? [])
    .filter((segment) => Number.isFinite(segment.energy) && segment.energy >= minEnergy && segment.start >= clip.start + leadIn && segment.start < clip.end - 0.6)
    .sort((a, b) => b.energy - a.energy || a.start - b.start);
  const chosen = [];
  for (const segment of candidates) {
    if (chosen.length >= max) break;
    if (chosen.every((time) => Math.abs(time - segment.start) >= spacing)) chosen.push(segment.start);
  }
  return chosen.sort((a, b) => a - b);
}

/** Instantes (relativos al clip montado) donde cambia el plano: el inicio de cada frase, separados al menos `spacing` s. */
export function phraseBoundaries(transcript, clip, timeline = null, { spacing = CLIP_FX.phraseSpacing, minStart = 1 } = {}) {
  const starts = (transcript?.segments ?? [])
    .filter((segment) => segment.start > clip.start && segment.start < clip.end - 1)
    .map((segment) => (timeline ? mapTime(timeline, segment.start) : segment.start - clip.start))
    .filter((time) => time !== null && time >= minStart)
    .sort((a, b) => a - b);
  const chosen = [];
  for (const time of starts) if (!chosen.length || time - chosen.at(-1) >= spacing) chosen.push(time);
  return chosen;
}

/**
 * Filtro de zoom del clip montado. Suma tres envolventes sobre la escala 1.0:
 *  - empuje (punch-in) con retorno suave y temblor en los picos de energía,
 *  - alternancia plano medio / primer plano en cada frase,
 *  - zoom del adelanto (cold open), que además se oscurece un instante al final.
 * Vacío si no hay nada que aplicar. Los tiempos van relativos al clip montado.
 */
export function punchFilter(times, width, height, { alternate = [], cold = 0 } = {}) {
  if (!times.length && !alternate.length && !cold) return '';
  const decimal = (value) => value.toFixed(3);
  const terms = [
    ...times.map((time) => `${CLIP_FX.punchZoom}*gte(t,${decimal(time)})*exp(-(t-${decimal(time)})/0.9)`),
    ...alternate.map((time, index) => `${index % 2 === 0 ? '' : '-'}${CLIP_FX.phraseZoom}*gte(t,${decimal(time)})*(1-exp(-(t-${decimal(time)})/0.12))`),
    ...(cold ? [`${CLIP_FX.coldZoom}*lt(t,${decimal(cold)})`] : []),
  ].map((term) => term.replace(/^\+/, ''));
  const zoom = terms.join('+').replace(/\+-/g, '-');
  const shake = (axis, amplitude, speed) => times.map((time) => `between(t,${decimal(time)},${decimal(time + CLIP_FX.shakeSeconds)})*${amplitude}*${axis}(t*${speed})`).join('+') || '0';
  const filters = [
    `scale=w='trunc(${width}*(1+${zoom})/2)*2':h='trunc(${height}*(1+${zoom})/2)*2':flags=bilinear:eval=frame`,
    `crop=${width}:${height}:x='(in_w-${width})/2+${shake('sin', 8, 95)}':y='(in_h-${height})/2+${shake('cos', 6, 110)}'`,
  ];
  if (cold) {
    const end = decimal(cold);
    filters.push(`eq=contrast='1+0.12*lt(t,${end})':saturation='1+0.25*lt(t,${end})':brightness='-clip((t-${decimal(Math.max(0, cold - CLIP_FX.coldDip))})/${CLIP_FX.coldDip},0,1)*lt(t,${end})':eval=frame`);
  }
  filters.push('setsar=1');
  return filters.join(',');
}

/** Grafo de recorte y unión de tramos. Los tiempos van relativos al inicio del clip (la entrada usa -ss). */
export function trimGraph(timeline, clipStart) {
  const count = timeline.parts.length;
  const rel = (value) => Math.max(0, value - clipStart).toFixed(3);
  const video = [`[0:v]split=${count}${timeline.parts.map((_, index) => `[vs${index}]`).join('')}`];
  const audio = [`[0:a:0]aresample=48000,aformat=channel_layouts=stereo,asplit=${count}${timeline.parts.map((_, index) => `[as${index}]`).join('')}`];
  timeline.parts.forEach((part, index) => {
    video.push(`[vs${index}]trim=start=${rel(part.start)}:end=${rel(part.end)},setpts=PTS-STARTPTS[v${index}]`);
    const fade = 0.02;
    audio.push(`[as${index}]atrim=start=${rel(part.start)}:end=${rel(part.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, part.duration - fade).toFixed(3)}:d=${fade}[a${index}]`);
  });
  video.push(`${timeline.parts.map((_, index) => `[v${index}]`).join('')}concat=n=${count}:v=1:a=0[vcut]`);
  audio.push(`${timeline.parts.map((_, index) => `[a${index}]`).join('')}concat=n=${count}:v=0:a=1[voice0]`);
  return { video: video.join(';'), audio: audio.join(';') };
}

/** Los grafos de composición empiezan siempre por [0:v]: se cambia por la etiqueta del vídeo ya recortado. */
export const retarget = (graph, label = 'vcut') => (graph.startsWith('[0:v]') ? `[${label}]${graph.slice(5)}` : graph);
