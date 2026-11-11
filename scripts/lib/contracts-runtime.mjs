import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const pattern = value => new RegExp('^' + value.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$');
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

/** Assemble exactly the contract COPY inputs of the pruned Docker runtime. */
export async function assembleContractRuntime(root, destination) {
  const docker = await readFile(join(root, 'deploy/docker/api.Dockerfile'), 'utf8');
  const runtime = docker.slice(docker.indexOf('FROM node:22-bookworm-slim AS runtime'));
  assert(runtime.startsWith('FROM '), 'API runtime stage is missing');
  for (const match of runtime.matchAll(/^COPY (.+)$/gm)) {
    const args = match[1].trim().split(/\s+/).filter(value => !value.startsWith('--'));
    const target = args.pop();
    for (const input of args) {
      const source = input.replace(/^\/workspace\//, '');
      if (!source.startsWith('packages/contracts/')) continue;
      assert(target.startsWith('packages/contracts/'), 'Contract runtime destination must remain in its package');
      const candidates = source.includes('*') ? (await readdir(join(root, dirname(source))))
        .filter(name => pattern(basename(source)).test(name)).map(name => join(dirname(source), name)) : [source];
      assert(candidates.length, `No runtime COPY input matches ${source}`);
      for (const candidate of candidates) {
        const output = join(destination, target, ...(target.endsWith('/') || args.length > 1 ? [basename(candidate)] : []));
        await mkdir(dirname(output), { recursive: true });
        await cp(join(root, candidate), output, { recursive: true });
      }
    }
  }
  const packageDirectory = join(destination, 'packages/contracts');
  const metadata = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  const inventory = await files(packageDirectory), entries = [];
  const targets = value => typeof value === 'string' ? [value] : Object.entries(value)
    .filter(([condition]) => condition !== 'types').flatMap(([, target]) => targets(target));
  for (const [key, value] of Object.entries(metadata.exports)) {
    for (const target of targets(value)) {
      assert(target.startsWith('./'), 'Runtime exports must be package-relative');
      if (target.includes('*')) {
        const matcher = pattern(target.slice(2));
        const matching = inventory.map(file => [file, matcher.exec(file)]).filter(([, result]) => result);
        assert(matching.length, `Export ${key} has no packaged runtime files`);
        for (const [file, result] of matching) entries.push({ specifier: '@open-triage/contracts' + key.slice(1).replace('*', result[1]), target: file });
      } else {
        assert(inventory.includes(target.slice(2)), `Declared runtime export ${key} is missing ${target}`);
        entries.push({ specifier: key === '.' ? '@open-triage/contracts' : '@open-triage/contracts' + key.slice(1), target: target.slice(2) });
      }
    }
  }
  await mkdir(join(destination, 'node_modules/@open-triage'), { recursive: true });
  await cp(packageDirectory, join(destination, 'node_modules/@open-triage/contracts'), { recursive: true });
  return { entries, packageDirectory };
}

/** Execute real compiled exports in isolation, without a checkout fallback. */
export function smokeContractRuntime(destination, entries) {
  const script = `for (const entry of ${JSON.stringify(entries)}) { await import(entry.specifier, entry.target.endsWith('.json') ? {with:{type:'json'}} : undefined); } console.log('Imported '+${entries.length}+' packaged contract exports');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: resolve(destination), encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `Assembled contract runtime imports failed: ${result.stderr}`);
  return result.stdout.trim();
}
