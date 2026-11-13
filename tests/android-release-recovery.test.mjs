import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const workflow = yaml.load(await readFile(resolve('.github/workflows/android-release-recovery.yml'), 'utf8'));
test('release recovery accepts only the exact tagged source with a successful original release preflight', async () => {
  const directory=await mkdtemp(join(tmpdir(),'android-release-recovery-'));
  try {
    const bin=join(directory,'bin');await mkdir(bin);
    const source='a'.repeat(40),tag='android-v8-0.1.0-rc.8';
    await writeFile(join(bin,'git'),'#!/bin/sh\nprintf "%s" "'+source+'"\n',{mode:0o700});
    await writeFile(join(bin,'gh'),`#!${process.execPath}
      const data=JSON.parse(process.env.FIXTURE_RESPONSES),path=process.argv[3];
      console.log(JSON.stringify(path.endsWith('/jobs')?data.jobs:path.includes('releases?')?data.releases:data.run));`,{mode:0o700});
    const step=workflow.jobs.stage.steps.find(step=>step.name==='Verify exact-source preflight and native acceptance');
    const script=step.run.split("<<'NODE'\n")[1].split('\nNODE')[0];
    const valid={run:{path:'.github/workflows/android-release.yml',event:'push',head_branch:tag,head_sha:source},jobs:{jobs:[{name:'preflight',conclusion:'success'},{name:'acceptance / Android 13 / hosted UI and private CA',conclusion:'success'}]},releases:[]};
    const receipt=join(directory,'preflight-evidence.json');
    const execute=data=>spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:directory,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:directory,GITHUB_REPOSITORY:'open-triage/open-triage-epcr',RELEASE_TAG:tag,PREFLIGHT_RUN:'123',FIXTURE_RESPONSES:JSON.stringify(data)}});
    const accepted=execute(valid);assert.equal(accepted.status,0,accepted.stderr);
    assert.equal(JSON.parse(await readFile(receipt,'utf8')).sourceCommit,source);
    for(const change of [data=>data.run.head_sha='b'.repeat(40),data=>data.run.head_branch='another-tag',data=>data.run.path='another-workflow.yml',data=>data.run.event='pull_request',data=>data.jobs.jobs[0].conclusion='failure',data=>data.jobs.jobs[1].conclusion='failure',data=>data.jobs.jobs.splice(1,1),data=>data.jobs.jobs.push({name:'acceptance / additional Android runtime',conclusion:'failure'}),data=>data.releases.push({tag_name:tag})]){
      await rm(receipt);const data=structuredClone(valid);change(data);
      assert.notEqual(execute(data).status,0,'Invalid preflight evidence must fail before any signed build');
      await assert.rejects(readFile(receipt),{code:'ENOENT'});
      // Restore only for the next iteration's removal.
      await writeFile(receipt,'');
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('recovery controller tags cannot start an unintended production release',async()=>{
  const entry=yaml.load(await readFile(resolve('.github/workflows/android-release.yml'),'utf8'));
  assert(entry.on.push.tags.includes('!android-v*-recovery'));
  assert.equal(entry.jobs.recover.if,"github.event_name == 'workflow_dispatch'");
  assert.equal(entry.on.workflow_dispatch.inputs.upgrade_harness.required,false);
  assert.equal(entry.jobs.recover.with.upgrade_harness,'${{ inputs.upgrade_harness }}');
  assert.equal(entry.jobs.release.with.upgrade_harness,undefined);
});

test('release recovery keeps existing credentials scoped and preserves only accepted production artifacts',()=>{
  assert.equal(workflow.permissions.contents,'read');assert.equal(workflow.permissions.actions,'read');
  assert.equal(workflow.jobs.stage.environment,'android-release');
  assert.deepEqual(workflow.jobs.stage.steps.find(step=>step.uses?.startsWith('actions/checkout@')).with,{ref:'${{ inputs.tag }}'});
  const emulator=workflow.jobs.stage.steps.find(step=>step.uses?.startsWith('reactivecircus/'));
  assert.equal(emulator.with.script,'node "$RUNNER_TEMP/recover-candidate.mjs"');
  assert.equal(emulator.env.GH_TOKEN,'${{ github.token }}');
  const upload=workflow.jobs.stage.steps.find(step=>step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with['if-no-files-found'],'error');assert.equal(upload.if,undefined,'Only successful acceptance may upload verified candidate assets');
  assert(upload.with.path.split('\n').filter(Boolean).every(path=>path.startsWith('${{ runner.temp }}/candidate/')));
  assert.equal(workflow.jobs.stage.steps.at(-1).if,'always()');
});

test('actual staging controller allows only test-only harness deltas before checkout and rebuilds only instrumentation', async () => {
 const controller=workflow.jobs.stage.steps.find(step=>step.name==='Prepare isolated acceptance controller').run.split("<<'NODE'\n")[1].split('\nNODE')[0];
 const guard=await readFile('scripts/android/upgrade-harness-source.mjs','utf8');
 for(const [harness,changedPaths,allowed]of [['',[],true],['b'.repeat(40),['android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java'],true],['b'.repeat(40),['android/app/src/main/java/org/opentriage/development/TrustedConnection.java'],false],['invalid',[],false]]){
  const directory=await mkdtemp(join(tmpdir(),'android-harness-stage-'));
  try{
   for(const name of ['bin','android','scripts/android','runner'])await mkdir(join(directory,name),{recursive:true});
   await writeFile(join(directory,'controller.mjs'),controller);
   await writeFile(join(directory,'scripts/android/upgrade-harness-source.mjs'),guard);
   await writeFile(join(directory,'runner/preflight-evidence.json'),'{}');
   const shim=`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const tool=path.basename(process.argv[1]),args=process.argv.slice(2);fs.appendFileSync(process.env.PROBE_LOG,JSON.stringify({tool,args,production:process.env.ANDROID_PRODUCTION_RELEASE,instrumentation:process.env.ANDROID_RELEASE_INSTRUMENTATION,versionCode:process.env.ANDROID_VERSION_CODE,versionName:process.env.ANDROID_VERSION_NAME})+'\\n');
   if(tool==='gh'){
    if(args[0]==='api')console.log(JSON.stringify([{tag_name:'android-v8-0.1.0-rc.8',draft:false}]));
    else fs.writeFileSync(path.join(args[args.indexOf('--dir')+1],'release.json'),JSON.stringify({versionCode:8}));
   }else if(tool==='npm'&&args.includes('android:release')){
    fs.mkdirSync(process.env.ANDROID_RELEASE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.ANDROID_RELEASE_OUTPUT,'release.json'),JSON.stringify({sourceCommit:'a'.repeat(40)}));
   }else if(tool==='git'&&args[0]==='diff')console.log(process.env.PROBE_DIFF);`;
   for(const executable of ['bin/gh','bin/npm','bin/git','android/gradlew'])await writeFile(join(directory,executable),shim,{mode:0o700});
   const result=spawnSync(process.execPath,[join(directory,'controller.mjs')],{cwd:directory,encoding:'utf8',env:{...process.env,PATH:join(directory,'bin')+':'+process.env.PATH,PROBE_LOG:join(directory,'commands.jsonl'),PROBE_DIFF:changedPaths.join('\n'),UPGRADE_HARNESS:harness,RELEASE_TAG:'android-v9-0.1.0-rc.9',RUNNER_TEMP:join(directory,'runner'),ANDROID_RELEASE_OUTPUT:join(directory,'candidate'),GITHUB_REPOSITORY:'synthetic/test'}});
   const commands=(await readFile(join(directory,'commands.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
   assert.equal(result.status===0,allowed,result.stdout+result.stderr);
   assert.equal(commands.filter(c=>c.tool==='git'&&c.args[0]==='checkout').length,allowed&&!!harness?1:0,'Disallowed changes never reach checkout');
   assert.equal(commands.filter(c=>c.tool==='gradlew').length,allowed&&!!harness?1:0);
   assert.equal(commands.filter(c=>c.tool==='npm'&&c.args.includes('android:release')).length,1,'Artifact is built once from the verified source');
   assert.equal(commands.filter(c=>c.tool==='npm'&&c.args.includes('android:test:upgrade')).length,allowed?1:0);
   if(allowed&&harness){
    const rebuild=commands.find(c=>c.tool==='gradlew');
    assert.deepEqual(rebuild.args,['--no-daemon',':app:assembleReleaseAndroidTest']);
    assert.equal(rebuild.production,'1');assert.equal(rebuild.instrumentation,'1');
    assert.equal(rebuild.versionCode,'9');assert.equal(rebuild.versionName,'0.1.0-rc.9');
   }
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});
