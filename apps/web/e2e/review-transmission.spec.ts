import {expect,test} from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';
for(const width of [390,1440])for(const identifying of [true,false])test(`COS operational Review requirements at ${width}px identifying=${identifying}`,async({page,context})=>{
 test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE!=='true');
 await page.setViewportSize({width,height:900});
 const reportId='123e4567-e89b-42d3-a456-426614174111',itemId='123e4567-e89b-42d3-a456-426614174112',userId='123e4567-e89b-42d3-a456-426614174114',now=new Date().toISOString();
 const session={csrfToken:'fixture',user:{id:userId,displayName:'Reviewer'},organization:{id:'organization',name:'Example EMS'},startedAt:now,expiresAt:'2099-10-02T20:00:00Z',capabilities:['review:all',...(identifying?['review:identifying']:[]),...(width===1440&&identifying?['settings:write']:[])],workspaceAvailable:true};
 const evidence={integration:'cos',deliveryId:'delivery',amendmentSequence:0,configurationRevision:'1',mappingId:'mapping',mappingRevision:1,mappingSha256:'a'.repeat(64),missing:['patientIdentifier','staff','careUnit','ambulanceCareUnit','encounter'],patientField:{field:{kind:'nemsis',elementId:'ePatient.01'},id:'ePatient.01',name:'Configured identifier'}};
 const item={id:itemId,reportId,criterionId:'123e4567-e89b-42d3-a456-426614174116',kind:'missing-transmission-identifiers',transmissionReason:'patient-identity',priority:'medium',status:'new',activeMatch:true,outcome:null,assigneeId:userId,version:0,firstMatchedAt:now,reportingDate:'2026-10-19',signedAt:now,findings:[],assignmentHistory:[],progressHistory:[],amendmentHistory:[],comments:[],commentsRestricted:!identifying,canComment:identifying,transmissionRestricted:!identifying,...(identifying?{transmission:evidence,transmissionHistory:[{itemVersion:0,active:true,recordedAt:now,evidence}]}:{})};
 await context.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/admin/context')return route.fulfill({json:{organization:session.organization,capabilities:session.capabilities,panels:['hospital']}});
  if(path==='/api/installation')return route.fulfill({json:{settings,appearance:{accentColor:'#315ba8',accentDarkColor:'#24447e',destructiveColor:'#8a2670',inactiveButtonColor:'#edf1fa',textColor:'#202850'}}});
  if(path==='/api/sessions/current')return route.fulfill({json:session});
  if(path==='/api/review/attention')return route.fulfill({json:{dataset:'real',asOf:now,total:0,assignments:0,responses:0,reopened:0}});
  if(path==='/api/review/queue')return route.fulfill({json:{dataset:'real',page:1,pageSize:25,total:1,assignmentCounts:{all:1,mine:1,unassigned:0},asOf:now,items:[item]}});
  if(path===`/api/review/items/${itemId}`)return route.fulfill({json:item});
  if(path==='/api/review/eligible-reviewers'||path==='/api/review/outcomes')return route.fulfill({json:[]});
  if(path===`/api/review/reports/${reportId}`)return route.fulfill({json:{id:reportId,reportingDate:'2026-10-19',signedAt:now,amendmentSequence:0,identifying,groups:[],values:[],notes:[],reviewItems:[{...item,criterionName:'COS: patient identity'}]}});
  return route.fulfill({status:404});
 });
 await page.goto('/');
 await page.locator('.review-queue-row td').nth(3).click();
 const inspector=page.locator('#review-inspector');await expect(inspector).toBeVisible();
 const requirements=inspector.getByRole('region',{name:'Missing transmission identifiers'});
 await expect(requirements).toBeVisible();
 if(identifying){
  await expect(requirements).toContainText('Configured identifier');
  for(const expected of ['Patient identifier is missing','Practitioner HSA identifier is missing','Destination care-unit mapping is missing','Default ambulance care unit is missing for a report without transport','Encounter identifier namespace is missing'])await expect(requirements).toContainText(expected);
  if(width===390)await expect(requirements).toContainText('authorized hospital integration administrator');
 }else{
  await expect(requirements).toContainText('Identifying report access is required');
  await expect(inspector).not.toContainText('Configured identifier');
 }
 await expect(inspector.getByRole('option',{name:'Close review',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('transmission-review.png'),fullPage:true});
 if(width===1440&&identifying){await page.getByRole('button',{name:'Open Hospital integrations administration'}).click();await expect(page.getByRole('heading',{name:'Hospital integrations',exact:true})).toBeVisible();}
 else await expect(page.getByRole('button',{name:'Open Hospital integrations administration'})).toHaveCount(0);
});
