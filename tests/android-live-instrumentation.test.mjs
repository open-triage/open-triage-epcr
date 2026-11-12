import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startLiveInstrumentation} from '../scripts/android/live-instrumentation.mjs';
const workspace=t=>{const directory=mkdtempSync(join(tmpdir(),'android-live-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;};
const report=(cwd,result)=>JSON.parse(readFileSync(join(cwd,result.diagnostics.reportPath),'utf8'));

test('normal instrumentation success before the live checkpoint cannot claim process-loss acceptance and preserves actual completion evidence',async t=>{
 const cwd=workspace(t),run=startLiveInstrumentation(process.execPath,['-e',"console.log('OK (1 test)')"],{cwd,phase:'normal-exit',checkpoint:'live-ready',timeoutMs:1000});
 const failure=await run.ready.then(()=>assert.fail('A normal exit is not live readiness'),error=>error),ended=await run.closed;
 assert.match(failure.message,/exited before/);assert.equal(ended.code,0);assert.equal(failure.diagnostics.exitCode,0);
 const evidence=report(cwd,ended);assert.equal(evidence.phase,'normal-exit');assert.equal(evidence.exitCode,0);assert.equal(evidence.signal,null);assert.match(evidence.output,/OK \(1 test\)/);
 assert.equal(statSync(join(cwd,ended.diagnostics.reportPath)).mode&0o777,0o600);
});
test('live checkpoint keeps the child alive until host termination and sanitizes evidence',async t=>{
 const cwd=workspace(t),run=startLiveInstrumentation(process.execPath,['-e',"console.log('token=synthetic-secret\\nlive-ready');setInterval(()=>{},1000)"],{cwd,checkpoint:'live-ready',timeoutMs:1000,redact:value=>value.replaceAll('synthetic-secret','[redacted]')});
 const evidence=await run.ready;assert(evidence.includes('live-ready'));assert(!evidence.includes('synthetic-secret'));assert.equal(run.child.exitCode,null);
 run.child.kill('SIGTERM');const ended=await run.closed;assert.equal(ended.signal,'SIGTERM');assert(!ended.output.includes('synthetic-secret'));assert.equal(ended.diagnostics,undefined);assert.equal(existsSync(join(cwd,'android/app/build/reports/android-live-instrumentation')),false);
});
test('missing checkpoints and excessive output terminate rather than hang and retain bounded failure evidence',async t=>{
 for(const [source,expected,signal] of [["process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",/timed out/,'SIGKILL'],["process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)",/exceeded/,'SIGTERM']]){
  const cwd=workspace(t),run=startLiveInstrumentation(process.execPath,['-e',source],{cwd,checkpoint:'live-ready',timeoutMs:1000,killGraceMs:50});
  await assert.rejects(run.ready,expected);const ended=await run.closed;assert.equal(ended.signal,signal);const evidence=report(cwd,ended);assert.match(evidence.reason,expected);assert(Buffer.byteLength(evidence.output)<=256*1024);assert.equal(evidence.truncated,expected.source==='exceeded');
 }
});
test('the original JUnit assertion survives an early Android runner exit while all credentials are sanitized before persistence',async t=>{
 const cwd=workspace(t),source=`console.log('INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: Agency UI condition failed: window.__completedHandoffHeld===true');console.error('plain known-secret password=another-secret open_triage_session=cookie-secret');console.log('-----BEGIN PRIVATE KEY-----\\nsynthetic-key\\n-----END PRIVATE KEY-----');`;
 const run=startLiveInstrumentation(process.execPath,['-e',source],{cwd,phase:'agency-prepare-completed',checkpoint:'agency_handoff_live=1',secrets:['known-secret'],timeoutMs:1000});
 const failure=await run.ready.then(()=>assert.fail('An assertion before the checkpoint must fail'),error=>error),ended=await run.closed,evidence=report(cwd,ended);
 assert.equal(ended.code,0);assert.match(evidence.output,/AssertionError: Agency UI condition failed: window\.__completedHandoffHeld===true/);assert.doesNotMatch(JSON.stringify(evidence),/known-secret|another-secret|cookie-secret|synthetic-key|BEGIN PRIVATE KEY/);
 assert.deepEqual(Object.keys(evidence).sort(),['version','phase','reason','exitCode','signal','truncated','output'].sort());assert(!JSON.stringify(failure.diagnostics).includes('AssertionError'));assert(!JSON.stringify(failure.diagnostics).includes('known-secret'));
});
test('spawn errors, nonzero exits and actual child signals preserve phase and terminal status',async t=>{
 const cases=[['/nonexistent/android-instrumentation',[],null], [process.execPath,['-e',"console.error('INSTRUMENTATION_FAILED: runner failed');process.exitCode=17"],null], [process.execPath,['-e',"console.log('INSTRUMENTATION_RESULT: shortMsg=Process crashed.');setImmediate(()=>process.kill(process.pid,'SIGTERM'))"],'SIGTERM']];
 for(const[command,args,signal]of cases){const cwd=workspace(t),run=startLiveInstrumentation(command,args,{cwd,phase:'failed-runner',checkpoint:'live-ready',timeoutMs:1000});await assert.rejects(run.ready,/could not start|exited before/);const ended=await run.closed,evidence=report(cwd,ended);assert.equal(evidence.exitCode,ended.code);assert.equal(evidence.signal,signal);assert.equal(evidence.phase,'failed-runner');if(args[1]?.includes('17'))assert.equal(evidence.exitCode,17);}
});
test('all shared live-instrumentation callers supply a safe distinct phase and sensitive callers provide known-secret redaction',()=>{
 for(const file of ['agency-handoff-journey','pdf-journey','report-journey','tls-journey']){const source=readFileSync(new URL(`../scripts/android/${file}.mjs`,import.meta.url),'utf8');assert.match(source,/phase:/,file);if(file!=='pdf-journey')assert.match(source,/secrets:/,file);}
 assert.throws(()=>startLiveInstrumentation(process.execPath,[],{checkpoint:'live-ready',phase:'../private'}),/safe instrumentation phase/);
});
