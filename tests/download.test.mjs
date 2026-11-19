import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanLiveLeftovers, dataDir, isFragmentFileError } from '../pipeline/media.mjs';
import { pythonOrDefault } from '../pipeline/runtime.mjs';

test('isFragmentFileError reconoce los fallos de archivos temporales de fragmentos y no otros', () => {
  assert.equal(isFragmentFileError("yt_dlp.utils.UnavailableVideoError: Unable to download video: [Errno 2] No such file or directory: 'source.f140.m4a.part-Frag47'"), true);
  assert.equal(isFragmentFileError('PermissionError: [WinError 5] Acceso denegado'), true);
  for (const message of ['PermissionError: [WinError 32] ...', '[WinError 32] El proceso no tiene acceso al archivo', '[WinError 5] Acceso denegado', '[WinError 2] No se encuentra el archivo', 'OSError: [Errno 2] No such file or directory']) {
    assert.equal(isFragmentFileError(message), true, message);
  }
  assert.equal(isFragmentFileError('[WinError 1234] otro error'), false, 'solo los códigos de archivo bloqueado o ausente');
  assert.equal(isFragmentFileError('HTTP Error 403: Forbidden'), false);
  assert.equal(isFragmentFileError('Sign in to confirm you are not a bot'), false);
  assert.equal(isFragmentFileError(undefined), false);
});

test('cleanLiveLeftovers borra los restos de la captura anterior y conserva el vídeo final y lo demás', async (t) => {
  await mkdir(dataDir, { recursive: true });
  const directory = await mkdtemp(join(dataDir, 'verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const leftovers = ['source.f299.mp4', 'source.f140.m4a.part', 'source.f140.m4a.ytdl', 'source.f140.m4a.part-Frag47', 'source.f299.mp4.part'];
  const keep = ['source.mkv', 'job.json', 'transcript.json', 'clip-1.mp4', 'candidates.json'];
  for (const name of [...leftovers, ...keep]) await writeFile(join(directory, name), 'x');
  const removed = await cleanLiveLeftovers(directory);
  assert.deepEqual(removed.sort(), [...leftovers].sort());
  assert.deepEqual((await readdir(directory)).sort(), [...keep].sort());
  assert.deepEqual(await cleanLiveLeftovers(directory), [], 'sin restos no hace nada');
  assert.deepEqual(await cleanLiveLeftovers(join(directory, 'no-existe')), []);
});

test('la captura de directos acepta el número de fragmentos simultáneos', async () => {
  const python = await pythonOrDefault();
  const help = execFileSync(python, [fileURLToPath(new URL('../pipeline/youtube_live.py', import.meta.url)), '--help'], { encoding: 'utf8' });
  assert.match(help, /--concurrency/);
  assert.match(help, /--max-fragments/);
});
