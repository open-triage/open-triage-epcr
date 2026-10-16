import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateNodeRuntime} from '../packages/contracts/runtime-node.cjs';

test('shared runtime guard rejects unsupported versions and disabled ESM interop before work',()=>{
  for(const version of ['20.19.0','22.0.0','22.11.9','22.12.0-rc.1','invalid'])assert.throws(()=>validateNodeRuntime({version}),/Node.js 22\.12\.0/);
  for(const version of ['22.12.0','22.12.1','22.23.2','23.0.0','24.0.0'])validateNodeRuntime({version,requireModule:true});
  for(const runtime of [{requireModule:false},{execArgv:['--no-experimental-require-module']},{nodeOptions:'--max-old-space-size=4096 --no-experimental-require-module'},{nodeOptions:'"--no-experimental-require-module"'}])assert.throws(()=>validateNodeRuntime({version:'22.12.0',...runtime}),/support enabled/);
});
test('local readiness and CI reject disabled CommonJS ESM before npm, ports or database work',()=>{
  for(const filename of ['../scripts/dev-local.mjs','../scripts/check-ci.mjs']){
    const result=spawnSync(process.execPath,['--no-experimental-require-module',fileURLToPath(new URL(filename,import.meta.url)),'--check'],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/OpenTriage requires Node.js 22\.12\.0/);assert.doesNotMatch(result.stdout,/npm run|database|Docker|startup/i);
  }
});
