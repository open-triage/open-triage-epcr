import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('integration groups mutating the shared hospital baseline run one file at a time', async () => {
  const root = new URL('../apps/api/', import.meta.url);
  const { scripts } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  let checked = 0;
  for (const command of scripts['test:integration'].split(' && ')) {
    const files = command.match(/tests\/[\w-]+\.integration\.test\.mjs/g) ?? [];
    if (files.length < 2) continue;
    const sources = await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')));
    if (!sources.some(source => source.includes("'./fixtures/hospital-baseline.mjs'"))) continue;
    checked++;
    // These transactions activate configuration for the ordinary seeded
    // organization and retain row locks until their finally/ROLLBACK boundary.
    assert.match(command, /--test-concurrency(?:=|\s+)1(?:\s|$)/, `${files.join(', ')} share a transaction-scoped organization fixture`);
  }
  assert(checked > 0, 'Keep representative shared-baseline integration coverage');
});
