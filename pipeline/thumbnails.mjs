import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getMediaTools } from './media.mjs';
import { bundledFont } from './runtime.mjs';

const run = promisify(execFile);

function escapeDrawtext(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function wrapCoverLines(text, maxChars = 15) {
  const words = String(text ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current.length + 1 + w.length) <= maxChars && lines.length < 2) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === 2) break;
    }
  }
  if (current && lines.length < 3) lines.push(current);
  return lines.slice(0, 2);
}

/**
 * Genera una miniatura JPG de alto impacto a partir del clip renderizado (o fuente),
 * aplicando contraste cinematográfico, viñeta inferior y texto de portada `coverText`.
 */
export async function generateClipThumbnail(videoPath, outPath, { timestamp = 1.2, coverText = '', accentHex = '#FFE600' } = {}) {
  const { ffmpeg } = await getMediaTools();
  const safeTs = Math.max(0.1, Number.isFinite(Number(timestamp)) ? Number(timestamp) : 1.2);
  const lines = wrapCoverLines(coverText, 16);
  const fontPath = (await bundledFont('Montserrat-Black.ttf')) || (await bundledFont('Inter-Bold.ttf'));
  const fontArg = fontPath ? `:fontfile='${fontPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ":font='Arial Black'";
  const hex = /^#[0-9a-f]{6}$/i.test(accentHex) ? `0x${accentHex.slice(1)}` : '0xFFE600';

  const filters = [
    'eq=contrast=1.08:saturation=1.18:brightness=-0.02',
    'drawbox=x=0:y=ih*0.58:w=iw:h=ih*0.42:color=black@0.58:t=fill',
  ];

  if (lines.length === 1) {
    filters.push(
      `drawtext=text='${escapeDrawtext(lines[0])}'${fontArg}:fontsize=h*0.068:fontcolor=white:borderw=7:bordercolor=black:shadowx=4:shadowy=4:shadowcolor=black@0.85:x=(w-text_w)/2:y=h*0.72`
    );
  } else if (lines.length >= 2) {
    filters.push(
      `drawtext=text='${escapeDrawtext(lines[0])}'${fontArg}:fontsize=h*0.064:fontcolor=white:borderw=7:bordercolor=black:shadowx=4:shadowy=4:shadowcolor=black@0.85:x=(w-text_w)/2:y=h*0.66`,
      `drawtext=text='${escapeDrawtext(lines[1])}'${fontArg}:fontsize=h*0.068:fontcolor=${hex}:borderw=7:bordercolor=black:shadowx=4:shadowy=4:shadowcolor=black@0.85:x=(w-text_w)/2:y=h*0.76`
    );
  }

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', safeTs.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', filters.join(','),
    '-q:v', '2',
    outPath,
  ];
  await run(ffmpeg, args, { timeout: 30_000, windowsHide: true });
  await access(outPath);
  return { path: outPath, timestamp: safeTs, lines };
}

export function thumbnailNameForClip(clipFile) {
  return String(clipFile).replace(/\.mp4$/i, '-thumb.jpg');
}

export function thumbnailPathForClip(directory, clipFile) {
  return join(directory, thumbnailNameForClip(clipFile));
}
