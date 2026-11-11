import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {DataSource} from 'typeorm';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {ANDROID_UPGRADE_GRACE_DEFAULT_DAYS} from '@open-triage/contracts/android-upgrade-policy';
import {AndroidUpgradePolicyController} from '../dist/admin/android-upgrade-policy.controller.js';
import {AndroidUpgradePolicyService} from '../dist/admin/android-upgrade-policy.service.js';
import {AndroidReleaseController} from '../dist/admin/android-release.controller.js';
import {AndroidReleaseService} from '../dist/admin/android-release.service.js';
import {InstallationEnrollmentService} from '../dist/admin/installation-enrollment.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';

test('default Android providers boot through real Nest injection without optional metadata or fetch overrides',async()=>{
 const previous=process.env.ANDROID_APPROVED_RELEASE;delete process.env.ANDROID_APPROVED_RELEASE;let app;
 const queried=[],capabilities=[];
 const database={manager:{query:async(sql)=>{queried.push(sql);return [{grace_days:90,revision:1,updated_at:'2026-01-01T00:00:00.000Z'}];}}};
 const sessions={getAuthenticated:async()=>({user:{id:'installation-owner'},installationOwner:true}),requireCapability:async(token,cap)=>{capabilities.push([token,cap]);}};
 class DefaultAndroidModule{};
 Module({controllers:[AndroidUpgradePolicyController,AndroidReleaseController],providers:[AndroidUpgradePolicyService,AndroidReleaseService,
  {provide:DataSource,useValue:database},{provide:ClinicianSessionService,useValue:sessions},{provide:InstallationEnrollmentService,useValue:{}}]})(DefaultAndroidModule);
 try{
  // No catalog, lifecycle or fetch provider is registered: exercise the exact production fallback constructors.
  // Throw bootstrap errors to node:test rather than letting Nest terminate the whole test file silently.
  app=await NestFactory.createApplicationContext(DefaultAndroidModule,{logger:false,abortOnError:false});
  const policy=await app.get(AndroidUpgradePolicyService).read('current-login');
  assert.equal(policy.policy.graceDays,ANDROID_UPGRADE_GRACE_DEFAULT_DAYS);assert.equal(policy.policy.revision,1);
  assert.deepEqual(policy.clients.map(client=>client.versionCode),catalog.releases.map(entry=>entry.descriptor.versionCode));
  assert(policy.clients.every(client=>client.status==='compatible'&&client.deadline===null&&client.replacement===null));
  assert.equal(queried.length,1);assert.match(queried[0],/app_identity\.android_upgrade_policy/);
  assert.deepEqual(await app.get(AndroidReleaseService).read('download-admin'),{status:'unavailable',reason:'not-selected'});
  assert.deepEqual(capabilities,[['download-admin','settings:read']]);
 }finally{if(app)await app.close();if(previous===undefined)delete process.env.ANDROID_APPROVED_RELEASE;else process.env.ANDROID_APPROVED_RELEASE=previous;}
});
