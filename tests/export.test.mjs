import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { clipFileName, exportJobClips, exportRoot, safeName } from '../pipeline/export.mjs';
import { jobsDir } from '../pipeline/jobs.mjs';

async function fakeJob(t, { title, files, summary = false }) {
  const id = randomUUID();
  const directory = join(jobsDir, id);
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of files) await writeFile(join(directory, file), `contenido de ${file}`);
  await writeFile(join(directory, 'clip-1.ass'), 'subtítulos');
  const clips = files.map((file) => ({ file, title: summary ? title : `Momento ${file}`, start: 0, end: 5, ...(summary ? { summary: true } : {}) }));
  return { id, title, clips, updatedAt: '2026-11-19T16:30:00.000Z' };
}

test('safeName deja nombres válidos en Windows', () => {
  assert.equal(safeName('¿Qué pasó? <GTA 6>: "gameplay" | 1/2 *final*...'), 'Qué pasó GTA 6 gameplay 1 2 final'.replace('Qué', '¿Qué'));
  assert.equal(safeName('CON'), 'Sin título');
  assert.equal(safeName('   ...  '), 'Sin título');
  assert.equal(safeName('Prueba � Mi vídeo'), 'Prueba Mi vídeo');
  assert.ok(safeName('a'.repeat(300)).length <= 80);
});

test('clipFileName numera los clips y usa solo el título para un vídeo único o un resumen', () => {
  assert.equal(clipFileName({ file: 'clip-3.mp4', title: 'El giro final' }, 5), '03 - El giro final.mp4');
  assert.equal(clipFileName({ file: 'clip-1.mp4', title: 'Resumen de la charla', summary: true }, 1), 'Resumen de la charla.mp4');
  assert.equal(clipFileName({ file: 'clip-1.mp4', title: 'Único' }, 1), 'Único.mp4');
});

test('exportJobClips crea una carpeta por proyecto solo con los clips, sin duplicar espacio y sin repetir trabajo', async (t) => {
  const title = `Proyecto de prueba ${randomUUID().slice(0, 8)}: «GTA»?`;
  const first = await fakeJob(t, { title, files: ['clip-1.mp4', 'clip-2.mp4'] });
  const second = await fakeJob(t, { title, files: ['clip-1.mp4'], summary: true });
  const noClips = await fakeJob(t, { title: 'Sin clips', files: [] });
  t.after(() => rm(exportRoot, { recursive: true, force: true }));

  const one = await exportJobClips(first);
  assert.equal(one.files, 2);
  assert.equal(one.folder, join(exportRoot, safeName(title)));
  assert.deepEqual((await readdir(one.folder)).sort(), ['01 - Momento clip-1.mp4.mp4', '02 - Momento clip-2.mp4.mp4']);
  assert.equal((await stat(join(one.folder, '01 - Momento clip-1.mp4.mp4'))).ino, (await stat(join(first.id ? join(jobsDir, first.id) : '', 'clip-1.mp4'))).ino, 'enlace duro');
  assert.equal((await exportJobClips(first)).files, 0, 'segunda pasada sin cambios');

  const two = await exportJobClips(second);
  assert.notEqual(two.folder, one.folder, 'un proyecto con el mismo título recibe otra carpeta');
  assert.match(two.folder, /\(2026-11-19 16-30\)$/);
  assert.deepEqual(await readdir(two.folder), [`${safeName(title, 'Resumen', 90)}.mp4`]);
  assert.equal((await exportJobClips(second)).folder, two.folder, 'la carpeta asignada es estable');

  assert.equal((await exportJobClips(noClips)).folder, null);
  assert.ok(!(await readdir(exportRoot)).includes('Sin clips'));
  assert.ok(!(await readdir(one.folder)).some((name) => name.endsWith('.ass')), 'solo vídeos');
});
