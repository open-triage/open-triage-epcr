import patientFixture from '../../../packages/contracts/examples/hospital/andrea-patient.json';
const patientIdentifier=patientFixture.identifier[0]!.value;
import {expect,test} from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';
for(const width of [390,1440])for(const authority of ['admin','review-only','nonidentifying'])test(`Review COS mapping repair ${width}px ${authority}`,async({page,context})=>{
 test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE!=='true');
 await page.setViewportSize({width,height:900});
 const reportId='123e4567-e89b-42d3-a456-426614174111',itemId='123e4567-e89b-42d3-a456-426614174112',userId='123e4567-e89b-42d3-a456-426614174114',now=new Date().toISOString();
 const identifying=authority!=='nonidentifying',admin=authority==='admin';
 const session={csrfToken:'fixture',user:{id:userId,displayName:'Integration administrator'},organization:{id:'organization',name:'Example EMS'},startedAt:now,expiresAt:'2099-10-02T20:00:00Z',capabilities:['review:all',...(identifying?['review:identifying']:[]),...(authority!=='review-only'?['settings:read','settings:write']:[])],workspaceAvailable:true};
 const evidence={integration:'cos',deliveryId:'123e4567-e89b-42d3-a456-426614174110',amendmentSequence:0,configurationRevision:'1',mappingId:'mapping',mappingRevision:1,mappingSha256:'a'.repeat(64),missing:['staff','careUnit'],patientField:null};
 let item={id:itemId,reportId,criterionId:'123e4567-e89b-42d3-a456-426614174116',kind:'missing-transmission-identifiers',transmissionReason:'integration-mapping',priority:'medium',status:'new',activeMatch:true,outcome:null,assigneeId:null,version:0,firstMatchedAt:now,reportingDate:'2026-10-19',signedAt:now,findings:[],assignmentHistory:[],progressHistory:[],amendmentHistory:[],comments:[],commentsRestricted:!identifying,canComment:identifying,transmissionRestricted:!identifying,...(identifying?{transmission:evidence,transmissionHistory:[{itemVersion:0,active:true,recordedAt:now,evidence}]}:{})};
 const repairContext={deliveryId:evidence.deliveryId,reportId,expectedVersion:0,configurationRevision:2,stateRevision:5,previousConfigurationRevision:1,previousMappingRevision:1,mappingRevision:2,missing:[],conflicts:['patientIdentifier','recipient'],safe:true,previousPatient:{field:{kind:'nemsis',elementId:'ePatient.05'},namespace:'urn:oid:1.2.752.129.2.1.3.1',value:null},patient:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',value:patientIdentifier}};
 let saved:Record<string,unknown>|null=null;
 await context.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/admin/context')return route.fulfill({json:{organization:session.organization,capabilities:session.capabilities,panels:['hospital']}});
  if(path==='/api/installation')return route.fulfill({json:{settings,appearance:{accentColor:'#315ba8',accentDarkColor:'#24447e',destructiveColor:'#8a2670',inactiveButtonColor:'#edf1fa',textColor:'#202850'}}});
  if(path==='/api/sessions/current')return route.fulfill({json:session});
  if(path==='/api/review/attention')return route.fulfill({json:{dataset:'real',asOf:now,total:0,assignments:0,responses:0,reopened:0}});
  if(path==='/api/review/queue')return route.fulfill({json:{dataset:'real',page:1,pageSize:25,total:1,assignmentCounts:{all:1,mine:0,unassigned:1},asOf:now,items:[item]}});
  if(path===`/api/review/items/${itemId}/mapping-repair`){
   if(route.request().method()==='GET')return route.fulfill({json:repairContext});
   saved=route.request().postDataJSON();expect(route.request().headers()['x-csrf-token']).toBe('fixture');item={...item,version:1,status:'completed',activeMatch:false};return route.fulfill({json:item});
  }
  if(path===`/api/review/items/${itemId}`)return route.fulfill({json:item});
  if(path==='/api/review/eligible-reviewers'||path==='/api/review/outcomes')return route.fulfill({json:[]});
  if(path===`/api/review/reports/${reportId}`)return route.fulfill({json:{id:reportId,reportingDate:'2026-10-19',signedAt:now,amendmentSequence:0,identifying,groups:[],values:[],notes:[],reviewItems:[{...item,criterionName:'COS: missing mappings'}]}});
  if(path==='/api/admin/hospital/cos')return route.fulfill({json:{groupName:'Example EMS',stateRevision:5,options:[],staffOptions:[],clinicalOptions:[],draft:null,active:null,tests:[],history:[],events:[]}});
  if(path==='/api/admin/hospital/eps')return route.fulfill({json:{groupName:'Example EMS',stateRevision:0,options:[],draft:null,active:null,tests:[],history:[],events:[]}});
  return route.fulfill({status:404});
 });
 await page.goto('/');await page.locator('.review-queue-row td').nth(3).click();const inspector=page.locator('#review-inspector');await expect(inspector).toBeVisible();
 const requirements=inspector.getByRole('region',{name:'Missing transmission identifiers'});await expect(requirements).toBeVisible();
 if(admin){
  await requirements.getByRole('button',{name:'Check active mappings'}).click();
  await expect(requirements).toContainText(patientIdentifier);await expect(requirements).toContainText('ePatient.05');await expect(requirements).toContainText('ePatient.01');
  const apply=requirements.getByRole('button',{name:'Revalidate and resume eligible delivery'});await expect(apply).toBeDisabled();
  await requirements.getByRole('checkbox',{name:'I verified that this configuration selection identifies the same patient.'}).check();await expect(apply).toBeDisabled();
  await requirements.getByRole('checkbox',{name:'I authorize the activated recipient and encounter routing for this unprepared delivery.'}).check();await expect(apply).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('mapping-repair-review.png'),fullPage:true});
  await apply.click();expect(saved).toMatchObject({dataset:'real',context:repairContext,acceptRecipientChange:true,acceptPatientMappingChange:true});
  await requirements.getByRole('button',{name:'Open Hospital integrations administration'}).click();
  await expect(page.getByRole('button',{name:'COS',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('heading',{name:'COS connection'})).toBeVisible();
 }else{
  await expect(requirements.getByRole('button',{name:'Check active mappings'})).toHaveCount(0);await expect(requirements.getByRole('button',{name:'Open Hospital integrations administration'})).toHaveCount(0);await expect(requirements).not.toContainText(patientIdentifier);
 }
});
