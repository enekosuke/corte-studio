import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'corte-storage-'));
process.env.CORTE_JOBS_DIR = root;
const { deleteProject, jobsDir, pruneStorage, scanStorage } = await import('../pipeline/storage.mjs');
const { handleSystemRoute } = await import('../routes/system-routes.mjs');
test.after(() => rm(root, { recursive: true, force: true }));

const origin = 'http://127.0.0.1:4173';
const exists = (path) => stat(path).then(() => true, () => false);
let counter = 0;
const newId = () => `${String(counter++).padStart(8, '0')}-0000-4000-8000-000000000000`;

async function project({ stage = 'done', ageDays = 0, bytes = 1000 } = {}) {
  const id = newId();
  const dir = join(jobsDir, id);
  await mkdir(join(dir, 'frames'), { recursive: true });
  await writeFile(join(dir, 'job.json'), JSON.stringify({ id, title: `Proyecto ${counter}`, stage, mode: 'normal', sourceReady: true, clips: [{ file: 'clip-1.mp4' }] }));
  await writeFile(join(dir, 'source.mp4'), Buffer.alloc(bytes * 10));
  await writeFile(join(dir, 'clip-1.mp4'), Buffer.alloc(bytes));
  await writeFile(join(dir, 'clip-1.ass'), 'subtítulos');
  await writeFile(join(dir, 'frames', 'f1.jpg'), Buffer.alloc(bytes / 2));
  const old = new Date(Date.now() - ageDays * 86_400_000);
  await utimes(join(dir, 'job.json'), old, old);
  return { id, dir };
}

function call(method, pathname, { body, query = '', headers = {} } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.headers = { origin, 'content-type': 'application/json', ...headers };
  const result = {};
  const sendJson = (_response, status, payload) => { result.status = status; result.payload = payload; };
  return handleSystemRoute({ request, response: {}, pathname, searchParams: new URLSearchParams(query), origin, sendJson }).then((handled) => ({ handled, ...result }));
}

test('scanStorage separa fuente, clips, temporales y otros por proyecto', async () => {
  const { id } = await project({ bytes: 2000 });
  const scan = await scanStorage();
  const found = scan.projects.find((entry) => entry.id === id);
  assert.equal(found.bytes.source, 20000);
  assert.equal(found.bytes.clips, 2000);
  assert.equal(found.bytes.temp, 1000);
  assert.ok(found.bytes.other > 0);
  assert.equal(found.bytes.total, found.bytes.source + found.bytes.clips + found.bytes.temp + found.bytes.other);
  assert.equal(found.clipCount, 1);
  assert.ok(scan.totals.total >= found.bytes.total);
  assert.ok(scan.disk === null || scan.disk.freeBytes > 0);
});

test('prune con keepClips conserva clips y SEO, respeta la edad y no toca trabajos en curso', async () => {
  const fresh = await project({ ageDays: 1 });
  const stale = await project({ ageDays: 40 });
  const running = await project({ ageDays: 90, stage: 'rendering' });
  const summary = await pruneStorage({ olderThanDays: 30, keepClips: true });
  assert.ok(summary.prunedProjects >= 1);
  assert.ok(summary.freedBytes >= 10000);
  assert.ok(summary.skipped.some((entry) => entry.id === running.id));
  assert.equal(await exists(join(stale.dir, 'source.mp4')), false);
  assert.equal(await exists(join(stale.dir, 'frames')), false);
  assert.equal(await exists(join(stale.dir, 'clip-1.mp4')), true);
  assert.equal(await exists(join(stale.dir, 'clip-1.ass')), true);
  assert.equal(JSON.parse(await readFile(join(stale.dir, 'job.json'), 'utf8')).sourceReady, false);
  assert.equal(await exists(join(fresh.dir, 'source.mp4')), true);
  assert.equal(await exists(join(running.dir, 'source.mp4')), true);
  await assert.rejects(() => pruneStorage({ olderThanDays: -1 }), { status: 400 });
});

test('prune sin keepClips elimina proyectos antiguos completos pero protege el activo', async () => {
  const doomed = await project({ ageDays: 100 });
  const active = await project({ ageDays: 100 });
  const summary = await pruneStorage({ olderThanDays: 60, keepClips: false, activeId: active.id });
  assert.ok(summary.removedProjects >= 1);
  assert.equal(await exists(doomed.dir), false);
  assert.equal(await exists(active.dir), true);
});

test('deleteProject borra la carpeta, detiene el trabajo activo y rechaza ids peligrosos', async () => {
  const { id, dir } = await project();
  let stopped = null;
  const result = await deleteProject(id, { stop: async (value) => { stopped = value; } });
  assert.equal(result.deleted, true);
  assert.equal(stopped, id);
  assert.equal(await exists(dir), false);
  await assert.rejects(() => deleteProject(id), { status: 404 });
  for (const bad of ['../../etc', '..', 'abc', `${id}/../x`, '']) await assert.rejects(() => deleteProject(bad), { status: 400 });
  const kept = await project();
  const light = await deleteProject(kept.id, { keepClips: true });
  assert.equal(light.deleted, false);
  assert.equal(await exists(join(kept.dir, 'clip-1.mp4')), true);
});

test('rutas del sistema: salud, almacenamiento, purga y DELETE exigen origen local y validan ids', async () => {
  assert.equal((await call('GET', '/api/health')).payload.ok, true);
  const storage = await call('GET', '/api/system/storage');
  assert.equal(storage.status, 200);
  assert.ok(Array.isArray(storage.payload.projects));
  await assert.rejects(() => call('POST', '/api/system/storage/prune', { body: {}, headers: { origin: 'http://evil.example' } }), { status: 403 });
  await assert.rejects(() => call('POST', '/api/system/storage/prune', { body: { olderThanDays: 'mucho' } }), { status: 400 });
  const { id } = await project();
  await assert.rejects(() => call('DELETE', `/api/jobs/${id}`, { headers: { origin: 'http://evil.example' } }), { status: 403 });
  await assert.rejects(() => call('DELETE', '/api/jobs/no-es-un-id'), { status: 400 });
  const done = await call('DELETE', `/api/jobs/${id}`, { query: 'keepClips=true' });
  assert.equal(done.payload.deleted, false);
  assert.equal((await call('GET', '/api/jobs')).handled, false);
});
