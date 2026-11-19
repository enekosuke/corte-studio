// Genera la biblioteca local de efectos de sonido (whoosh, pop, riser, hit, bleep, record_scratch) de forma procedural con
// FFmpeg. No hay muestras de terceros: los sonidos son síntesis propia y se dedican al dominio público (CC0).
//
//   node scripts/generate-sfx.mjs
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getMediaTools } from '../pipeline/media.mjs';

const run = promisify(execFile);
export const sfxDir = fileURLToPath(new URL('../pipeline/assets/sfx/', import.meta.url));

export const sfxRecipes = {
  // Ruido rosa con envolvente en campana y filtro de paso de banda: barrido de aire.
  whoosh: { seconds: 0.7, source: "anoisesrc=d=0.7:c=pink:a=0.9:r=48000,highpass=f=350,lowpass=f=7000,volume='pow(sin(PI*t/0.7),2)*1.6':eval=frame" },
  // Burbuja corta: seno que cae de agudo a medio con decaimiento rápido.
  pop: { seconds: 0.16, source: "aevalsrc='0.9*sin(2*PI*(650+2600*exp(-t*45))*t)*exp(-t*32)':d=0.16:s=48000" },
  // Tono ascendente con ruido que crece: tensión antes del clímax.
  riser: { seconds: 1.5, source: "aevalsrc='(sin(2*PI*(180*t+420*t*t))*0.55+(random(0)*2-1)*0.25)*pow(t/1.5,1.4)':d=1.5:s=48000" },
  // Golpe grave con caída de tono.
  hit: { seconds: 0.55, source: "aevalsrc='0.95*sin(2*PI*(42+90*exp(-t*14))*t)*exp(-t*7)+0.25*(random(0)*2-1)*exp(-t*55)':d=0.55:s=48000" },
  // Pitido de censura de 1 kHz.
  bleep: { seconds: 0.5, source: "aevalsrc='0.35*sin(2*PI*1000*t)':d=0.5:s=48000,afade=t=in:d=0.01,afade=t=out:st=0.49:d=0.01" },
  // Arañazo de disco: ruido modulado por un tono que desciende.
  record_scratch: { seconds: 0.55, source: "aevalsrc='(random(0)*2-1)*0.55*sin(2*PI*(1100-1700*t)*t)*exp(-t*3.2)':d=0.55:s=48000" },
};

export async function generateSfx(directory = sfxDir) {
  const { ffmpeg } = await getMediaTools();
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const [name, { source }] of Object.entries(sfxRecipes)) {
    const target = join(directory, `${name}.ogg`);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-af', 'aformat=channel_layouts=stereo,alimiter=limit=0.95', '-ar', '48000', '-c:a', 'libvorbis', '-q:a', '4', target], { windowsHide: true });
    files.push(target);
  }
  await writeFile(join(directory, 'LICENSE.txt'), 'Sonidos generados proceduralmente con FFmpeg por scripts/generate-sfx.mjs.\nNo contienen muestras de terceros. Dedicados al dominio público (CC0 1.0).\n', 'utf8');
  return files;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  console.log((await generateSfx()).map((file) => file.replace(sfxDir, '')).join('\n'));
}
