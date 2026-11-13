import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runReassignmentTransition} from '../scripts/android/reassignment-journey.mjs';

test('reassignment keeps installation authority live until clinical recovery finishes, then proves revocation preserves ciphertext',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'reassignment-order-'));
 try{
  const state=join(directory,'live'),adb=join(directory,'adb'),events=[];
  await writeFile(adb,`#!${process.execPath}\nconst fs=require('fs');if(process.argv.includes('pidof')&&fs.readFileSync(${JSON.stringify(state)},'utf8')==='live')console.log('123');`,{mode:0o700});
  let unitId;
  const db={query:async(sql,args)=>{
   if(sql.includes('select id,installation_identity_id'))return{rows:[{id:'old',installation_identity_id:'stable',credential_sha256:'old-credential'}]};
   if(sql.includes('insert into app_identity.operational_unit'))unitId=args[0];
   if(sql.startsWith('select id,unit_id'))return{rows:[{id:'old',revoked_at:'now'},{id:'new',unit_id:unitId,credential_sha256:'rotated',revoked_at:null}]};
   if(sql.includes('count(*)'))return{rows:[{n:'1'}]};
   return{rows:[]};
  }};
  const api=async(fixture,ca,path)=>{
   if(path.endsWith('/enrollment'))return{status:201,body:{token:'synthetic',origin:'https://fixture.test'}};
   if(path==='__android-enrollment-drop-release')return{body:{released:true}};
   if(path==='__android-native-authentication-count')return{status:200,body:{count:0}};
   assert.equal(path,`admin/units/${unitId}/installations/new/revoke`);events.push('revoked');return{status:201,body:{revoked:true}};
  };
  const finish=await runReassignmentTransition({fixture:{unitId:'original',organizationId:'org',clinician:{userId:'clinician'}},report:{secondClinician:{userId:'other'}},adb,serial:'isolated',db,api,ca:Buffer.from('synthetic-ca'),adminHeaders:{},retainedSha256:'a'.repeat(64),
   run:(command,args)=>{if(args.includes('force-stop'))writeFileSync(state,'stopped');},
   prepareUntilKilled:()=>{writeFileSync(state,'live');return{ready:new Promise(resolve=>setTimeout(resolve,20)),closed:Promise.resolve(),child:{kill(){}}};},
   instrument:phase=>{events.push(phase);return phase==='pairing-snapshot'?'retained_sha256='+'b'.repeat(64):'OK';},
  });
  assert.equal(typeof finish,'function');assert.deepEqual(events,['resume-reassignment']);
  events.push('clinical-recovery-finished');await finish();
  assert.deepEqual(events,['resume-reassignment','clinical-recovery-finished','pairing-snapshot','revoked','revoked-pairing']);
 }finally{await rm(directory,{recursive:true,force:true});}
});
