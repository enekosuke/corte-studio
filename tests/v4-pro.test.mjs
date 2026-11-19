import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateEdl, generateFcpxml } from '../pipeline/export-nle.mjs';
import { getMediaTools } from '../pipeline/media.mjs';
import { generateClipThumbnail } from '../pipeline/thumbnails.mjs';

const run = promisify(execFile);

test('generateEdl y generateFcpxml producen formatos válidos CMX 3600 y FCPXML 1.9', () => {
  const parts = [{ start: 10.0, end: 15.5 }, { start: 18.0, end: 24.0 }];
  const edl = generateEdl({ title: 'Clip Viral', sourceName: 'source.mp4', parts, fps: 30 });
  assert.match(edl, /^TITLE: Clip Viral/m);
  assert.match(edl, /001\s+AX\s+AA\/V\s+C\s+00:00:10:00 00:00:15:15 00:00:00:00 00:00:05:15/);
  assert.match(edl, /002\s+AX\s+AA\/V\s+C\s+00:00:18:00 00:00:24:00 00:00:05:15 00:00:11:15/);

  const xml = generateFcpxml({ title: 'Clip Viral & Pro', sourceName: 'source.mp4', parts, fps: 30 });
  assert.match(xml, /<fcpxml version="1\.9">/);
  assert.match(xml, /Clip Viral &amp; Pro #1/);
  assert.match(xml, /Clip Viral &amp; Pro #2/);
});

test('generateClipThumbnail crea un JPG real con coverText usando FFmpeg', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'corte-thumb-'));
  try {
    const { ffmpeg } = await getMediaTools();
    const sample = join(dir, 'clip-1.mp4');
    const out = join(dir, 'clip-1-thumb.jpg');
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      sample,
    ], { timeout: 20_000 });

    const res = await generateClipThumbnail(sample, out, {
      timestamp: 0.8,
      coverText: 'FINAL IMPOSIBLE',
      accentHex: '#FFE600',
    });
    const info = await stat(res.path);
    assert.ok(info.size > 4000, `thumbnail JPG should be >4KB, got ${info.size}`);
    assert.equal(res.lines.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
