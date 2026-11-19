import { buildSmartBoxes } from './analysis.mjs';
import { wordsInRange } from './clipfx.mjs';
import { analyzeActiveSpeaker } from './media.mjs';

// Hablante activo: decide quién habla en cada instante cruzando el movimiento de boca (pipeline/active_speaker.py)
// con las palabras de la transcripción, y convierte la decisión en cortes limpios hacia su cara.

export const ASD = {
  floor: 0.004, // por debajo de este movimiento de boca nadie "habla" (ruido de compresión)
  dominance: 1.6, // el que habla se mueve al menos 1,6 veces más que el segundo
  overlapShare: 0.7, // si el segundo llega al 70 % del primero hablan a la vez
  minHold: 1.5, // un plano dura al menos 1,5 s
  maxOverlap: 0.45, // con más solape que esto se conserva la pantalla dividida
};

/**
 * Quién habla en cada ventana. Devuelve segmentos { start, end, speaker } (segundos relativos al clip; speaker es un
 * índice de puesto o 'both') y el reparto de tiempo.
 */
export function decideSpeakers(analysis, words, clip, options = {}) {
  const { floor, dominance, overlapShare, minHold } = { ...ASD, ...options };
  const slots = analysis?.slots?.length ?? 0;
  const windows = analysis?.windows ?? [];
  if (slots < 2 || !windows.length) return { segments: [], overlapFraction: 0, switches: 0, speakers: [] };
  const length = analysis.window ?? 0.5;
  const raw = windows.map(({ t, scores }) => {
    const speech = words.some((word) => word.end > clip.start + t && word.start < clip.start + t + length);
    const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const [top, second] = order;
    if (!speech || top.score < floor) return null;
    if (second.score >= floor && second.score >= overlapShare * top.score) return 'both';
    return top.score >= dominance * Math.max(second.score, 1e-6) ? top.index : null;
  });
  const firstKnown = raw.find((value) => value !== null);
  if (firstKnown === undefined) return { segments: [], overlapFraction: 0, switches: 0, speakers: [] };
  let previous = firstKnown;
  const filled = raw.map((value) => { previous = value ?? previous; return previous; });

  let segments = [];
  filled.forEach((speaker, index) => {
    const start = windows[index].t;
    const end = start + length;
    if (segments.length && segments.at(-1).speaker === speaker) segments.at(-1).end = end;
    else segments.push({ start, end, speaker });
  });
  // Los planos cortos se funden con el anterior (o con el siguiente si son el primero) para no marear.
  for (let index = 0; index < segments.length && segments.length > 1;) {
    if (segments[index].end - segments[index].start >= minHold) { index++; continue; }
    const target = index > 0 ? index - 1 : 1;
    segments[target] = { speaker: segments[target].speaker, start: Math.min(segments[target].start, segments[index].start), end: Math.max(segments[target].end, segments[index].end) };
    segments.splice(index, 1);
    segments = segments.reduce((merged, segment) => {
      if (merged.length && merged.at(-1).speaker === segment.speaker) merged.at(-1).end = segment.end;
      else merged.push({ ...segment });
      return merged;
    }, []);
    index = Math.max(0, index - 1);
  }
  const total = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0) || 1;
  const overlap = segments.filter(({ speaker }) => speaker === 'both').reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const speakers = [...new Set(segments.map(({ speaker }) => speaker).filter((speaker) => speaker !== 'both'))];
  return { segments, overlapFraction: Number((overlap / total).toFixed(3)), switches: Math.max(0, segments.length - 1), speakers };
}

/** Trayectoria de la cámara en "fill": un punto por cambio de hablante con cutBefore (corte limpio, sin paneo). */
export function speakerTrack(decision, analysis) {
  const track = [];
  let current = decision.speakers[0] ?? 0;
  for (const segment of decision.segments) {
    if (segment.speaker !== 'both') current = segment.speaker;
    const slot = analysis.slots[current];
    const point = { offset: Number(segment.start.toFixed(3)), x: Number((slot.x + slot.w / 2).toFixed(4)), y: Number(Math.min(0.9, slot.y + slot.h * 0.55).toFixed(4)) };
    const previous = track.at(-1);
    if (previous && Math.abs(previous.x - point.x) < 0.02) continue;
    track.push({ ...point, cutBefore: Boolean(previous) });
  }
  if (track.length) track[0].offset = 0;
  return track;
}

const distinctFaceFrames = (sceneData) => (sceneData?.frames ?? []).filter((frame) => {
  const [a, b] = [...(frame.faces ?? [])].sort((x, y) => x.left - y.left);
  return a && b && Math.abs((b.left + b.right) / 2 - (a.left + a.right) / 2) > 0.25;
}).length;

/**
 * Si el encuadre elegido es una charla de dos personas (pantalla dividida o seguimiento), corta al que habla.
 * Con mucho solape (se interrumpen o ríen a la vez) conserva el encuadre original. Nunca lanza: ante cualquier duda
 * devuelve el encuadre recibido.
 */
export async function refineSpeakerFraming({ source, directory, clip, clipNumber, framing, sceneData, transcript, format, media, signal, analyze = analyzeActiveSpeaker }) {
  try {
    if (!['fill', 'split'].includes(framing?.layout) || !format.layouts.includes('fill')) return framing;
    const frames = sceneData?.frames ?? [];
    if (!frames.length || distinctFaceFrames(sceneData) < Math.ceil(frames.length / 2)) return framing;
    const analysis = await analyze(source, directory, clip, clipNumber, { signal });
    if (!analysis || analysis.slots?.length < 2) return framing;
    const decision = decideSpeakers(analysis, wordsInRange(transcript, clip.start, clip.end), clip);
    if (!decision.segments.length || decision.overlapFraction > ASD.maxOverlap) return framing;
    const track = speakerTrack(decision, analysis);
    if (!track.length) return framing;
    const region = { width: Math.min(0.9, Math.max(...analysis.slots.map((slot) => slot.w)) * 2.2), height: Math.min(0.95, Math.max(...analysis.slots.map((slot) => slot.h)) * 2.4) };
    return {
      layout: 'fill',
      reason: `Hablante activo: ${decision.switches ? `${decision.switches} cortes limpios al que habla` : 'plano fijo en quien habla'}.`,
      tracks: [track],
      regions: [region],
      boxes: buildSmartBoxes('fill', [track], [region], format, media?.aspect ?? 16 / 9),
      activeSpeaker: { switches: decision.switches, overlapFraction: decision.overlapFraction, speakers: decision.speakers.length },
    };
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error;
    return framing;
  }
}
