import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {ClinicianSessionController,SESSION_COOKIE} from '../dist/sessions/clinician-session.controller.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {CsrfGuard} from '../dist/sessions/csrf.guard.js';
import {OidcPersonalController} from '../dist/authentication/oidc-personal.controller.js';

test('generic continuation is a real CSRF-guarded readonly route with ordinary limited-account metadata eligibility',async()=>{
 const csrf='c'.repeat(43),digest=value=>createHash('sha256').update(value).digest('hex'),queries=[];
 const row={session_id:'session',user_id:'principal',display_name:'Current name',organization_id:'agency',organization_name:'Agency',active:true,agency_access:true,
  created_at:new Date(Date.now()-3600000),expires_at:new Date(Date.now()+1800000),revoked_at:null,csrf_sha256:digest(csrf),
  session_credential_version:'1',credential_version:'1',must_change_password:false,authentication_source:'local',authentication_valid:true,
  personally_authenticated_at:new Date(Date.now()-3600000),personal_authentication_purpose:'login'};
 let capabilities=['clinical:document'];
 const query=async sql=>{queries.push(sql);if(sql.includes('select csrf_sha256'))return row.revoked_at?[]:[{csrf_sha256:row.csrf_sha256}];if(sql.includes('select s.id as session_id'))return[row];if(sql.includes('select capability.key'))return capabilities.map(capability_key=>({capability_key}));if(sql.includes('from app_identity.production_workflow_rollout'))return[{group_id:'agency',revision:1,enabled_at:null}];return[];};
 const sessions=new ClinicianSessionService({manager:{query}});class TestModule{}
 Module({controllers:[ClinicianSessionController],providers:[{provide:ClinicianSessionService,useValue:sessions}]})(TestModule);
 let app;
 try{
  app=await NestFactory.create(TestModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api');app.useGlobalGuards(new CsrfGuard(sessions));await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(),url=base+'/api/sessions/current/continuation';
  const request=proof=>fetch(url,{method:'POST',headers:{cookie:`${SESSION_COOKIE}=native-token`,'content-type':'application/json',...(proof?{'x-csrf-token':proof}:{})},body:'{}'});
  for(const proof of [undefined,'wrong'])assert.equal((await request(proof)).status,401);
  for(const mode of ['ordinary','temporary-password','no-workspace']){
   row.must_change_password=mode==='temporary-password';row.temporary_password_expires_at=new Date(Date.now()+3600000);capabilities=mode==='no-workspace'?[]:['clinical:document'];
   const response=await request(csrf);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const current=await response.json();
   assert.equal(current.user.id,'principal');assert.deepEqual(current.capabilities,capabilities);assert.equal(current.passwordChangeRequired,row.must_change_password);assert.equal(current.workspaceAvailable,capabilities.length>0);assert.equal(current.csrfToken,undefined);
   assert.equal(current.expiresAt,row.expires_at.toISOString());assert.equal(current.personallyAuthenticatedAt,row.personally_authenticated_at.toISOString());
   if(mode!=='ordinary')await assert.rejects(sessions.requireCapability('native-token','clinical:document'));
  }
  row.revoked_at=new Date();assert.equal((await request(csrf)).status,401);row.revoked_at=null;row.expires_at=new Date(Date.now()-1);assert.equal((await request(csrf)).status,401);
  assert(queries.filter(sql=>/update|insert|delete/i.test(sql)).every(sql=>sql.includes('set last_activity_at')),'Readonly continuation cannot issue sessions or renew proof/expiry');
 }finally{if(app)await app.close();}
});

test('native OIDC finish supplies fresh public continuation with cookie delivery and exact-cookie retry without exporting credentials',async()=>{
 const session={csrfToken:'c'.repeat(43),user:{id:'oidc-principal'},organization:{id:'agency'},capabilities:['current:role'],expiresAt:'2099-01-01T00:00:00Z',personallyAuthenticatedAt:'2026-01-01T00:00:00Z'};
 for(const delivered of [false,true]){
  const cookies=[];const controller=new OidcPersonalController({nativeFinish:async()=>({outcome:'succeeded',session,...(!delivered?{created:{sessionToken:'private-cookie-token',session}}:{})})},{});
  const result=await controller.nativeFinish({secret:'private-return-secret'},{headers:{}},'1',{cookie:(...args)=>cookies.push(args)});
  assert.deepEqual(result,{outcome:'succeeded',session});assert.equal(cookies.length,delivered?0:1);assert(!JSON.stringify(result).includes('private-cookie-token'));assert(!JSON.stringify(result).includes('private-return-secret'));
 }
});
