import assert from 'node:assert/strict';
import test from 'node:test';
import {startLiveInstrumentation} from '../scripts/android/live-instrumentation.mjs';

test('normal instrumentation success before the live checkpoint cannot claim process-loss acceptance',async()=>{
 const run=startLiveInstrumentation(process.execPath,['-e',"console.log('OK (1 test)')"],{checkpoint:'live-ready',timeoutMs:1000});
 await assert.rejects(run.ready,/exited before/);assert.equal((await run.closed).code,0);
});
test('live checkpoint keeps the child alive until host termination and sanitizes evidence',async()=>{
 const run=startLiveInstrumentation(process.execPath,['-e',"console.log('token=synthetic-secret\\nlive-ready');setInterval(()=>{},1000)"],{checkpoint:'live-ready',timeoutMs:1000,redact:value=>value.replaceAll('synthetic-secret','[redacted]')});
 const evidence=await run.ready;assert(evidence.includes('live-ready'));assert(!evidence.includes('synthetic-secret'));assert.equal(run.child.exitCode,null);
 run.child.kill('SIGTERM');const ended=await run.closed;assert.equal(ended.signal,'SIGTERM');assert(!ended.output.includes('synthetic-secret'));
});
test('missing checkpoints and excessive output terminate rather than hang',async()=>{
 for(const [source,expected,signal] of [["process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",/timed out/,'SIGKILL'],["process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)",/exceeded/,'SIGTERM']]){
  const run=startLiveInstrumentation(process.execPath,['-e',source],{checkpoint:'live-ready',timeoutMs:1000,killGraceMs:50});
  await assert.rejects(run.ready,expected);assert.equal((await run.closed).signal,signal);
 }
});
