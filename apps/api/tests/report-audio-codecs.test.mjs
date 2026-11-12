import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReportAudioNormalizer } from '../dist/reports/report-audio-normalizer.service.js';

for (const [extension, contentType] of [['webm', 'audio/webm'], ['m4a', 'audio/mp4']]) {
  test(`real Chromium ${contentType} time slices normalize to fully decoded mono AAC`, async () => {
    class MeasuredNormalizer extends ReportAudioNormalizer {
      paths = [];
      async probe(path) { this.paths.push(path); return super.probe(path); }
    }
    const normalizer = new MeasuredNormalizer();
    const source = await readFile(new URL(`fixtures/audio/chromium-timeslices.${extension}`, import.meta.url));
    const normalized = await normalizer.normalize(source, contentType);
    assert(normalized.durationMilliseconds >= 1000 && normalized.durationMilliseconds <= 2500);
    assert.equal(normalized.bytes.subarray(4, 8).toString('ascii'), 'ftyp');
    assert(normalized.bytes.byteLength > 0);
    assert(normalizer.paths.length >= 2, 'Source and canonical output are both probed');
    await Promise.all(normalizer.paths.map(path => assert.rejects(access(path))));
  });
}

test('a real duration-less live WebM longer than five minutes is rejected without truncating it into an accepted note', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'open-triage-audio-boundary-'));
  const file = join(directory, 'synthetic-live.webm');
  try {
    const normalizer = new ReportAudioNormalizer();
    await normalizer.ffmpeg(['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-t', '301', '-c:a', 'libopus', '-b:a', '8k', '-f', 'webm', '-live', '1', file]);
    const metadata = await normalizer.probe(file);
    assert.equal(metadata.format?.duration, undefined, 'The long fixture has the same absent-duration property as browser time slices');
    await assert.rejects(normalizer.normalize(await readFile(file), 'audio/webm'), /exceeds the five-minute limit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
