import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {runInstrumentation} from '../scripts/android/instrumentation.mjs';

test('an instrumented child can authenticate against a fixture hosted by its parent process',async()=>{
  let served=false;
  const fixture=createServer((_request,response)=>{served=true;response.end('fixture-ready');});
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
  try{
    const output=await runInstrumentation(process.execPath,['--input-type=module','-e',
      "const response=await fetch(process.argv[1]);if(await response.text()!=='fixture-ready')process.exit(2);console.log('OK (1 test)')",
      `http://127.0.0.1:${fixture.address().port}`],{timeout:3000});
    assert(served,'The parent fixture event loop must remain live until instrumentation finishes');
    assert.match(output,/OK \(1 test\)/);
  }finally{fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
});
