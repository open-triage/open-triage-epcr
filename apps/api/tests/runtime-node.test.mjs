import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('API and operational entry points reject unsupported interop before the ESM framework loads',()=>{
  for(const path of ['main.js','identity/identity-account.cli.entry.js','review/review-worker.entry.js','dispatch/dispatch-file-cli.entry.js']){
    const result=spawnSync(process.execPath,['--no-experimental-require-module',fileURLToPath(new URL(`../dist/${path}`,import.meta.url))],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/OpenTriage requires Node.js 22\.12\.0/);assert.doesNotMatch(result.stderr,/ERR_REQUIRE_ESM|Cannot find module/);
  }
});
