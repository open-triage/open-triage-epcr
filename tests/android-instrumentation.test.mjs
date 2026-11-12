import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {runInstrumentation,adbShellArguments} from '../scripts/android/instrumentation.mjs';

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

test('remote Android shell preserves whitespace, quotes and metacharacters as literal instrumentation arguments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'android-shell-'));
  try {
    const fake=join(directory,'adb.mjs');
    await writeFile(fake,"import {spawn} from 'node:child_process';const args=process.argv.slice(2);const child=spawn('/bin/sh',['-c',args.slice(args.indexOf('shell')+1).join(' ')],{stdio:'inherit'});child.on('exit',code=>process.exitCode=code??1);");
    const values=['Reopen report',"O'Brien",'Åsa 😀','line\nbreak','$(printf injected)','semi;colon','"quoted"','back\\slash',''];
    const output=await runInstrumentation(process.execPath,[fake,'-s','fixture','shell',process.execPath,'-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--',...values]);
    assert.deepEqual(JSON.parse(output),values);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('live preparation and synchronous recovery preserve empty middle options and all literal shell values',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'android-shell-driver-'));
  try{
    const fake=join(directory,'adb.mjs');
    await writeFile(fake,"import {spawn} from 'node:child_process';const args=process.argv.slice(2);const child=spawn('/bin/sh',['-c',args.slice(args.indexOf('shell')+1).join(' ')],{stdio:'inherit'});child.on('exit',code=>process.exitCode=code??1);");
    const values=['-e','upgradeReceipt','','-e','artifactBase64','opaque','space value',"O'Brien",'pipe|literal','$(printf injected)','`printf injected`','Åsa 😀','runner'];
    const args=adbShellArguments([fake,'-s','fixture','shell',process.execPath,'-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--',...values]);
    const sync=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(sync.error,undefined);assert.equal(sync.status,0,sync.stderr);assert.deepEqual(JSON.parse(sync.stdout),values);
    const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    const [code]=await once(child,'close');assert.equal(code,0,stderr);assert.deepEqual(JSON.parse(stdout),values);
  }finally{await rm(directory,{recursive:true,force:true});}
});
