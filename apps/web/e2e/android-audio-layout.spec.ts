import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import demoAssignedCalls from '../public/demo-assigned-calls.json';
import demoOpenAssignment from '../public/demo-open-assignment.json';
import productionSettings from '@open-triage/contracts/config/installation.production.json';

for (const enlarged of [false,true]) for(const viewport of [{width:320,height:616},{width:390,height:844},{width:640,height:320}]) test(`shared mobile actions and audio remain reachable at ${viewport.width}x${viewport.height}, enlarged text=${enlarged}`, async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const now=new Date().toISOString(),reportId=demoOpenAssignment.report.id;
  const session={csrfToken:'synthetic-csrf',user:{id:demoOpenAssignment.report.documentingUserId,displayName:'Synthetic Android clinician'},organization:{id:'32000000-0000-4000-8000-000000000001',name:'Synthetic agency'},capabilities:['clinical:document'],workspaceAvailable:true,startedAt:now,expiresAt:'2099-01-01T00:00:00Z'};
  const note={id:'95000000-0000-4000-8000-000000000001',reportId,type:'audio',caption:'SYNTHETIC-AUDIO-PLAYBACK',capturedAt:now,capturedUtcOffsetMinutes:0,author:session.user,serverReceivedAt:now,updatedAt:now,persistenceState:'ready',contentType:'audio/mp4',byteSize:16,sha256:'a'.repeat(64),durationMilliseconds:3000};
  const opened={...demoOpenAssignment,report:{...demoOpenAssignment.report,notes:[note]}};
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin',NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION:'false'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';createRoot(document.getElementById('root')).render(<Home/>);"}});
  const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8')+await readFile(path.resolve(__dirname,'../app/session-layout.css'),'utf8');
  await page.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
  await page.route('**/__native-audio-layout',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0]!.text}</script></body></html>`}));
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url()).pathname;
    if(url==='/api/installation')return route.fulfill({json:{settings:productionSettings}});
    if(url==='/api/sessions/current')return route.fulfill({json:session});
    if(url==='/api/calls/assigned')return route.fulfill({json:demoAssignedCalls});
    if(url==='/api/reports/open')return route.fulfill({json:{openCalls:[{...opened.report,reportId,callNumber:'SYNTHETIC-AUDIO',lastSavedAt:now,syncStatus:'saved',validationErrorCount:0}],completedReportIds:[],refreshedAt:now}});
    if(/\/calls\/[^/]+\/open$/.test(url))return route.fulfill({json:opened});
    if(url.endsWith('/protected-key-envelope'))return route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});
    if(url.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
    if(url.endsWith('/protected-ciphertext-checkpoint'))return route.fulfill({json:route.request().postDataJSON()});
    if(url.endsWith('/active'))return route.fulfill({status:304});
    return route.fulfill({status:404,json:{}});
  });
  await page.goto('/__native-audio-layout');
  await expect(page.locator('[data-change-installation]')).toHaveCount(0);
  if(enlarged)await page.addStyleTag({content:':root{--text-caption:18px;--text-body:21px;--text-control:24px;--text-heading:36px}'});
  expect(await page.locator('.session-account').evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThan(100);
  expect(await page.locator('.session-bar').evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(viewport.height*.6);
  await page.screenshot({path:testInfo.outputPath(`native-session-header-${enlarged}.png`)});
  await page.getByRole('button',{name:'Open call',exact:true}).first().click();
  await expect(page.locator('.sync-status')).toHaveText('Saved');
  await expect(page.locator('[data-change-installation]')).toHaveCount(0);
  const actions=page.locator('.quick-actions');
  const before=await actions.evaluate(element=>{const r=element.getBoundingClientRect();return{top:r.top+scrollY,scroll:scrollY}});
  await page.evaluate(top=>window.scrollTo(0,top+300),before.top);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before.scroll+50);
  await expect.poll(()=>actions.evaluate(element=>element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  await expect.poll(()=>actions.evaluate(element=>element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport.height+1);
  await expect(actions.locator('button')).toHaveCount(6);
  for(const button of await actions.locator('button').all()){
    expect(await button.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    const box=await button.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({path:testInfo.outputPath(`sticky-actions-${viewport.width}x${viewport.height}-${enlarged}.png`)});
  await page.getByRole('button',{name:'Text note',exact:true}).click();
  await expect(page.getByLabel('Note text')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.active-report-notice')).toHaveCount(0);
  expect(await page.locator('.session-account').evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThan(100);
  expect(await page.locator('.session-bar').evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(viewport.height*.6);
  const play=page.locator('.audio-note-event').filter({hasText:'SYNTHETIC-AUDIO-PLAYBACK'}).locator('.timeline-audio-action');
  await expect(play).toBeVisible();
  await play.evaluate(element=>element.scrollIntoView({block:'end',inline:'nearest',behavior:'instant'}));
  // Fractional font metrics can put a border a fraction of one CSS pixel outside.
  const bounds=await play.evaluate(element=>{const r=element.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};});
  expect(bounds.top).toBeGreaterThanOrEqual(-1);expect(bounds.bottom).toBeLessThanOrEqual(viewport.height+1);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);expect(bounds.right).toBeLessThanOrEqual(viewport.width+1);
  expect(await play.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`native-audio-reachable-${enlarged}.png`)});
});
