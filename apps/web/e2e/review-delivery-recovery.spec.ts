import {expect,test} from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';
for(const width of [390,1440])for(const state of ['failed','uncertain','confirmed','permanent','restricted'])test(`COS recovery ${state} at ${width}px`,async({page,context})=>{
 test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE!=='true');
 await page.setViewportSize({width,height:900});
 const reportId='123e4567-e89b-42d3-a456-426614174111',itemId='123e4567-e89b-42d3-a456-426614174112',userId='123e4567-e89b-42d3-a456-426614174114',now=new Date().toISOString();
 const identifying=state!=='restricted';let retries=0;
 const session={csrfToken:'fixture',user:{id:userId,displayName:'Reviewer'},organization:{id:'organization',name:'Example EMS'},startedAt:now,expiresAt:'2099-10-02T20:00:00Z',capabilities:['review:all',...(identifying?['review:identifying']:[])],workspaceAvailable:true};
 const evidence={integration:'cos',deliveryId:'123e4567-e89b-42d3-a456-426614174118',amendmentSequence:2,configurationRevision:'3',mappingId:'mapping',mappingRevision:4,mappingSha256:'a'.repeat(64),missing:[],patientField:null,deliveryState:state==='permanent'||state==='restricted'?'failed':state,finding:state==='uncertain'?'outcomeUnknown':state==='permanent'?'identityConflict':'outage',stateRevision:5,retryable:state==='failed',recoveryCommands:[{id:'prior',actorId:userId,deliveryId:'old',amendmentSequence:1,requestedAt:now,outcome:'failed'}]};
 const item={id:itemId,reportId,criterionId:'123e4567-e89b-42d3-a456-426614174116',kind:'cos-delivery-failed',transmissionReason:'delivery-failure',priority:'medium',status:state==='confirmed'?'completed':'new',activeMatch:state!=='confirmed',outcome:null,assigneeId:userId,version:7,firstMatchedAt:now,reportingDate:'2026-10-19',signedAt:now,findings:[],assignmentHistory:[],progressHistory:[],amendmentHistory:[],comments:[],commentsRestricted:!identifying,canComment:identifying,transmissionRestricted:!identifying,...(identifying?{transmission:evidence,transmissionHistory:[{itemVersion:7,active:state!=='confirmed',recordedAt:now,evidence}]}:{})};
 await context.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/installation')return route.fulfill({json:{settings,appearance:{accentColor:'#315ba8',accentDarkColor:'#24447e',destructiveColor:'#8a2670',inactiveButtonColor:'#edf1fa',textColor:'#202850'}}});
  if(path==='/api/sessions/current')return route.fulfill({json:session});
  if(path==='/api/review/attention')return route.fulfill({json:{dataset:'real',asOf:now,total:0,assignments:0,responses:0,reopened:0}});
  if(path==='/api/review/queue')return route.fulfill({json:{dataset:'real',page:1,pageSize:25,total:1,assignmentCounts:{all:1,mine:1,unassigned:0},asOf:now,items:[item]}});
  if(path===`/api/review/items/${itemId}/retry-cos`){
   retries++;const command=route.request().postDataJSON();expect(command).toMatchObject({expectedVersion:7,dataset:'real',deliveryId:evidence.deliveryId,amendmentSequence:2,configurationRevision:3,stateRevision:5});
   evidence.deliveryState='pending';evidence.finding=null as unknown as string;evidence.retryable=false;item.version++;
   return route.fulfill({json:item});
  }
  if(path===`/api/review/items/${itemId}`)return route.fulfill({json:item});
  if(path==='/api/review/eligible-reviewers'||path==='/api/review/outcomes')return route.fulfill({json:[]});
  if(path===`/api/review/reports/${reportId}`)return route.fulfill({json:{id:reportId,reportingDate:'2026-10-19',signedAt:now,amendmentSequence:2,identifying,groups:[],values:[],notes:[],reviewItems:[item],cosDelivery:{simulated:true,state:evidence.deliveryState,finding:evidence.finding,paused:false,updatedAt:now,configurationRevision:3,mappingRevision:4,reviewItemId:itemId}}});
  return route.fulfill({status:404});
 });
 await page.goto('/');await page.locator('.review-queue-row td').nth(3).click();
 const inspector=page.locator('#review-inspector');await expect(inspector).toBeVisible();
 await expect(inspector.getByRole('option',{name:'Close review',exact:true})).toHaveCount(0);
 const retry=inspector.getByRole('option',{name:'Retry latest signed version',exact:true});
 if(state==='failed'){
  await expect(retry).toHaveCount(1);await inspector.getByRole('combobox',{name:'Action',exact:true}).selectOption('retry-cos');
  await inspector.getByRole('button',{name:'Retry latest signed version',exact:true}).click();
  await expect(inspector).toContainText('Delivery queued. This Review item stays open');expect(retries).toBe(1);
  await expect(inspector.getByRole('option',{name:'Retry latest signed version',exact:true})).toHaveCount(0);
 }else{
  await expect(retry).toHaveCount(0);
  await expect(inspector).toContainText(state==='uncertain'?'Retry is blocked':state==='confirmed'?'Delivery confirmed':state==='restricted'?'Identifying report access is required':'Correct the indicated payload');
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('delivery-recovery.png'),fullPage:true});
 if(identifying){await inspector.getByText('Manual recovery history',{exact:true}).click();await expect(inspector).toContainText('signed amendment 1');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(retries).toBe(state==='failed'?1:0);
});
