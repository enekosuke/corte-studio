import { planSilenceParts, wordsInRange } from './clipfx.mjs';

// Exportación profesional a DaVinci Resolve y Adobe Premiere Pro: CMX 3600 (.edl) y FCPXML 1.9 (.fcpxml).

function smpte(seconds, fps = 30) {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

export function buildClipPartsForExport(clip, transcript, { removeSilences = false } = {}) {
  const start = clip.edits?.trimStart ?? clip.start ?? 0;
  const end = clip.edits?.trimEnd ?? clip.end ?? Math.max(start + 1, 10);
  if (!removeSilences || !transcript?.segments?.length) {
    return [{ start, end }];
  }
  const words = wordsInRange(transcript, start, end);
  return planSilenceParts(words, { start, end });
}

/** Genera un archivo EDL CMX 3600 estándar listo para importar en Premiere Pro o DaVinci Resolve. */
export function generateEdl({ title = 'Corte Studio Clip', sourceName = 'source.mp4', parts = [], fps = 30 }) {
  const lines = [
    `TITLE: ${String(title).replace(/[\r\n]+/g, ' ').slice(0, 70)}`,
    'FCM: NON-DROP FRAME',
    '',
  ];
  let recordCursor = 0;
  parts.forEach((part, index) => {
    const dur = Math.max(0.1, part.end - part.start);
    const num = String(index + 1).padStart(3, '0');
    lines.push(`${num}  AX       AA/V  C        ${smpte(part.start, fps)} ${smpte(part.end, fps)} ${smpte(recordCursor, fps)} ${smpte(recordCursor + dur, fps)}`);
    lines.push(`* FROM CLIP NAME: ${sourceName}`);
    lines.push('');
    recordCursor += dur;
  });
  return lines.join('\n');
}

/** Genera un proyecto FCPXML 1.9 compatible con DaVinci Resolve, Final Cut Pro y Premiere Pro. */
export function generateFcpxml({ title = 'Corte Studio Clip', sourceName = 'source.mp4', parts = [], fps = 30, width = 1080, height = 1920 }) {
  const totalDur = parts.reduce((acc, p) => acc + Math.max(0.1, p.end - p.start), 0);
  const toFrac = (sec) => `${Math.round(sec * fps * 100)}/${fps * 100}s`;
  let offset = 0;
  const clipsXml = parts.map((part, idx) => {
    const dur = Math.max(0.1, part.end - part.start);
    const xml = `            <asset-clip name="${xmlEscape(`${title} #${idx + 1}`)}" ref="r2" offset="${toFrac(offset)}" start="${toFrac(part.start)}" duration="${toFrac(dur)}" tcFormat="NDF"/>`;
    offset += dur;
    return xml;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${width}x${height}p${fps}" frameDuration="100/${fps * 100}s" width="${width}" height="${height}"/>
    <asset id="r2" name="${xmlEscape(sourceName)}" src="file://localhost/${encodeURIComponent(sourceName)}" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="Corte Studio">
      <project name="${xmlEscape(title)}">
        <sequence format="r1" duration="${toFrac(totalDur)}" tcStart="0s" tcFormat="NDF">
          <spine>
${clipsXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
