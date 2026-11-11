import assert from 'node:assert/strict';
import test from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stopFixtureChild} from '../scripts/android/fixture-processes.mjs';

for(const resists of [false,true]) test(`synthetic API shutdown awaits ${resists?'forced':'graceful'} child exit before resource removal`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'android-child-'));let child;
 try {
  const script=join(directory,'child.mjs');
  await writeFile(script,`process.on('SIGTERM',()=>{${resists?'':'process.exit(0)'}});setInterval(()=>{},1000);process.send({ready:true});`);
  child=fork(script,[],{stdio:['ignore','ignore','ignore','ipc']});await once(child,'message');
  const result=await stopFixtureChild(child,{graceMs:100});
  assert.equal(result.forced,resists);assert(child.exitCode!==null||child.signalCode!==null);
  assert.deepEqual(await stopFixtureChild(child),{forced:false});
 } finally {if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(directory,{recursive:true,force:true});}
});
