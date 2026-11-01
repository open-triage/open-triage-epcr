import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
for(const width of [390,1440])test(`EPS export follow-up in Review at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const now=new Date().toISOString(),userId='123e4567-e89b-42d3-a456-426614174114',reportId='123e4567-e89b-42d3-a456-426614174111';
 const session={csrfToken:'fixture',user:{id:userId,displayName:'Reviewer'},organization:{id:'agency',name:'EMS'},capabilities:['review:all','review:identifying'],startedAt:now,expiresAt:'2099-01-01T00:00:00Z'};
 const item={id:'123e4567-e89b-42d3-a456-426614174112',reportId,criterionId:'123e4567-e89b-42d3-a456-426614174116',kind:'eps-export',priority:'medium',status:'new',activeMatch:true,outcome:null,assigneeId:userId,version:1,firstMatchedAt:now,reportingDate:'2026-10-19',signedAt:now,findings:[],assignmentHistory:[],progressHistory:[],amendmentHistory:[],comments:[],commentsRestricted:false,canComment:true};
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{ReviewShell}from'./components/review-shell';
 createRoot(document.getElementById('root')).render(<ReviewShell session={${JSON.stringify(session)}} language="en" online attention={null} onAttentionRefresh={()=>{}}/>);`}})).outputFiles[0]!.text;
 const css=(await Promise.all(['styles.css','review-workspace.css'].map(file=>readFile(path.resolve(__dirname,'../app',file),'utf8')))).join('\n');
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/api/review/queue')return route.fulfill({json:{dataset:'real',page:1,pageSize:25,total:1,assignmentCounts:{all:1,mine:1,unassigned:0},asOf:now,items:[item]}});
  if(pathname===`/api/review/items/${item.id}`)return route.fulfill({json:item});
  if(pathname===`/api/review/reports/${reportId}`)return route.fulfill({json:{id:reportId,reportingDate:'2026-10-19',signedAt:now,amendmentSequence:0,identifying:true,signedSnapshotId:'signed-snapshot',groups:[],values:[],notes:[],reviewItems:[item]}});
  if(pathname===`/api/reports/${reportId}/eps/submissions/availability`)return route.fulfill({json:{active:true}});
  if(pathname===`/api/reports/${reportId}/eps/submissions`)return route.fulfill({json:[]});
  if(pathname==='/api/review/eligible-reviewers' ||pathname==='/api/review/outcomes')return route.fulfill({json:[]});
  return route.fulfill({status:404,json:{}});
 });
 await page.route('**/__review-eps',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.goto('/__review-eps');
 await page.locator('.review-queue-row td').nth(3).click();
 const inspector=page.locator('#review-inspector');
 await expect(inspector.getByRole('region',{name:'EPS export'})).toContainText('EPS acceptance has not been confirmed.');
 await expect(inspector.getByRole('option',{name:'Close review',exact:true})).toHaveCount(0);
 await inspector.getByRole('button',{name:'Submit EPS',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Submit EPS'}).getByRole('button',{name:'Build with current mapping',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('eps-review.png'),fullPage:true});
});
