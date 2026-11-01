import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

// Nest watches API sources; Node must also watch loaded workspace dependencies.
test('API development reloads rebuilt shared exports after a startup failure', {timeout:30000}, async()=>{
 const pkg=JSON.parse(await readFile(new URL('../apps/api/package.json',import.meta.url),'utf8'));
 assert.ok(pkg.scripts.dev.includes('nest start --watch --exec \\"node --watch --watch-preserve-output\\"'));
 const dir=await mkdtemp(path.join(tmpdir(),'api-shared-watch-'));
 const dependency=path.join(dir,'shared.cjs');
 await writeFile(dependency,'module.exports = {};');
 await writeFile(path.join(dir,'api.cjs'),`const shared=require('./shared.cjs'); console.log('API_VALUE:'+shared.destinationDecision()); setInterval(()=>{},1000);`);
 const child=spawn(process.execPath,['--watch','--watch-preserve-output',path.join(dir,'api.cjs')],{stdio:['ignore','pipe','pipe']});
 let output=''; const listeners=new Set();
 const collect=chunk=>{output+=chunk;for(const notify of listeners)notify();};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const waitFor=needle=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(check);reject(new Error('Missing '+needle+' in '+output));},10000);
  function check(){if(output.includes(needle)){clearTimeout(timer);listeners.delete(check);resolve();}}
  listeners.add(check);check();
 });
 try {
  await waitFor('TypeError');
  // The child can fail before the watch supervisor has registered dependencies.
  // Wait for its ready message before changing the file, rather than racing startup.
  await waitFor('Waiting for file changes before restarting...');
  await writeFile(dependency,`exports.destinationDecision=()=> 'none';`);
  await waitFor('API_VALUE:none');
  await writeFile(dependency,`exports.destinationDecision=()=> 'destination';`);
  await waitFor('API_VALUE:destination');
 } finally {
  const closed=once(child,'close');child.kill('SIGTERM');await closed;
  await rm(dir,{recursive:true,force:true});
 }
});
