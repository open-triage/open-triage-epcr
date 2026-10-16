import { expect,test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import en from "../messages/en.json";
import sv from "../messages/sv.json";
let script:string,css:string;
test.beforeAll(async()=>{
  css=await readFile(path.resolve(__dirname,"../app/styles.css"),"utf8");
  const result=await build({bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env":JSON.stringify({NEXT_PUBLIC_API_URL:"same-origin"})},stdin:{resolveDir:path.resolve(__dirname,".."),loader:"tsx",contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OidcDraftPanel} from './components/oidc-draft';createRoot(document.getElementById('root')).render(<OidcDraftPanel language={document.documentElement.lang} csrfToken="csrf" canWrite={!location.search.includes('readonly')}/>);`}});script=result.outputFiles[0]!.text;
});
const draft={revision:1,name:"Regional AD FS",issuer:"https://idp.example.org/adfs",discoveryUrl:"",clientId:"regional-client",scopes:["openid","profile"],mappings:{displayName:"name",email:"email"},credentialConfigured:true,requiredFields:[],discoveryHealth:"unchecked",discovery:null,discoveredAt:null};
const initial={groupId:"group",groupName:"Test Agency",agencyCount:1,draft,active:{...draft,name:"Active identity provider"},registration:{hosts:[{origin:"https://agency.example.org",callbackUrl:"https://agency.example.org/api/sessions/oidc/callback",logoutCallbackUrl:"https://agency.example.org/api/sessions/oidc/logout-callback"}],requiredClaims:["iss","sub","aud","exp","iat","nonce"]},history:[]};
for(const width of [390,1440])test(`OIDC drafts mask credentials, retain active state on discovery failure and preserve edits at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route("**/__oidc",route=>route.fulfill({contentType:"text/html",body:`<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="admin-panel agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route("**/__oidc-script",route=>route.fulfill({contentType:"text/javascript",body:script}));
  let state=structuredClone(initial),saveFails=true,refreshFails=false,authenticated=false;
  await page.route("**/api/sessions/reauthenticate",route=>{expect(route.request().headers()["x-csrf-token"]).toBe("csrf");authenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
  await page.route("**/api/admin/authentication/oidc",route=>{
    if(route.request().method()==="PUT"){
      expect(authenticated).toBe(false);expect(route.request().headers()["x-csrf-token"]).toBe("csrf");const body=route.request().postDataJSON();expect(body).not.toHaveProperty("groupId");
      if(body.issuer.startsWith("http:"))return route.fulfill({status:422,json:{code:"admin.oidcInvalid",params:{field:"issuer"}}});
      if(saveFails)return route.fulfill({status:409,json:{code:"admin.oidcStale"}});
      expect(body.replacementSecret).toBe("new-client-secret");state={...state,draft:{...state.draft,...body,revision:2}};delete (state.draft as unknown as Record<string,unknown>).replacementSecret;
    }else if(refreshFails)return route.fulfill({status:503,json:{code:"admin.http503"}});
    return route.fulfill({json:state});
  });
  await page.route("**/api/admin/authentication/oidc/discovery",route=>{expect(route.request().postDataJSON()).toEqual({expectedRevision:2});state={...state,draft:{...state.draft,discoveryHealth:"failed"}};return route.fulfill({json:state});});
  await page.goto("/__oidc");
  await expect(page.getByText("Saved client secret: Configured (hidden)")).toBeVisible();await expect(page.getByLabel("Replacement client secret")).toHaveValue("");
  await expect(page.getByLabel("Callback URL",{exact:true})).toHaveValue("https://agency.example.org/api/sessions/oidc/callback");
  await page.getByLabel("Callback URL",{exact:true}).focus();expect(await page.getByLabel("Callback URL",{exact:true}).evaluate((el:HTMLInputElement)=>el.selectionEnd! - el.selectionStart!)).toBe("https://agency.example.org/api/sessions/oidc/callback".length);
  await page.getByLabel("Issuer address").fill("http://127.0.0.1");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("alert")).toHaveText("Invalid OIDC field: issuer.");await expect(page.getByLabel("Issuer address")).toHaveValue("http://127.0.0.1");await page.getByLabel("Issuer address").fill(draft.issuer);
  await page.getByLabel("Provider name").fill("Changed draft");await page.getByLabel("Replacement client secret").fill("discarded-secret-on-failure");await page.getByRole("button",{name:"Save OIDC draft"}).click();
  await expect(page.getByRole("alert")).toContainText("The OIDC draft changed");await expect(page.getByLabel("Provider name")).toHaveValue("Changed draft");await expect(page.getByLabel("Replacement client secret")).toHaveValue("");
  refreshFails=true;page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Reload OIDC draft"}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByLabel("Provider name")).toHaveValue("Changed draft");
  saveFails=false;await page.getByLabel("Replacement client secret").fill("new-client-secret");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("status")).toHaveText("Draft saved");
  await expect(page.getByRole("button",{name:"Check discovery"})).toBeEnabled();
  await page.getByLabel("Provider name").fill("Unsaved edit");await expect(page.getByRole("button",{name:"Check discovery"})).toHaveCount(0);await page.getByLabel("Provider name").fill("Changed draft");
  await page.getByRole("button",{name:"Check discovery"}).click();await expect(page.getByRole("status")).toHaveText("Discovery failed. Active configuration retained.");await expect(page.getByText("Active provider: Active identity provider")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/oidc-draft-${width}.png`,fullPage:true});
});
test("Swedish read-only OIDC setup shows IT registration without discovery diagnostics",async({page})=>{
  await page.route("**/__oidc?*",route=>route.fulfill({contentType:"text/html",body:`<html lang="sv"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route("**/__oidc-script",route=>route.fulfill({contentType:"text/javascript",body:script}));
  await page.route("**/api/admin/authentication/oidc",route=>route.fulfill({json:{...initial,draft:{...draft,discoveryHealth:"healthy",discovery:{issuer:draft.issuer,signingKeyIds:["key-2026","key-2027"]}}}}));
  await page.goto("/__oidc?readonly=1");await expect(page.getByRole("heading",{name:"OIDC-leverantörens utkast"})).toBeVisible();await expect(page.getByLabel("Leverantörens namn")).toBeDisabled();await expect(page.locator('input[type="password"]')).toHaveCount(0);await expect(page.getByText("key-2026, key-2027")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Registreringsuppgifter för IT"})).toBeVisible();
  await expect(page.getByLabel("Callback-adress",{exact:true})).toHaveValue(initial.registration.hosts[0]!.callbackUrl);
  await expect(page.getByLabel("Logout callback-adress",{exact:true})).toHaveCount(0);
});

test("a new OIDC draft leaves provider registration values for IT and can save an incomplete version",async({page})=>{
  await page.route("**/__oidc-new",route=>route.fulfill({contentType:"text/html",body:`<html lang="en"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route("**/__oidc-script",route=>route.fulfill({contentType:"text/javascript",body:script}));
  await page.route("**/api/sessions/reauthenticate",route=>route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}}));
  await page.route("**/api/admin/authentication/oidc",route=>{
    if(route.request().method()==="PUT"){
      const body=route.request().postDataJSON();expect(body).toMatchObject({expectedRevision:0,name:"IT registration pending",issuer:"",clientId:"",scopes:["openid"],mappings:{displayName:"",email:""}});expect(body).not.toHaveProperty("replacementSecret");
      return route.fulfill({json:{...initial,active:null,draft:{...draft,...body,revision:1,credentialConfigured:false}}});
    }
    return route.fulfill({json:{...initial,draft:null,active:null}});
  });
  await page.goto("/__oidc-new");await expect(page.getByLabel("Scopes (space separated)")).toHaveValue("openid");await expect(page.getByLabel("Display name claim")).toHaveValue("");await expect(page.getByLabel("Email claim (optional)")).toHaveValue("");await expect(page.getByLabel("Client ID")).toHaveValue("");
  await expect(page.getByRole("button",{name:"Check discovery"})).toHaveCount(0);
  await page.getByLabel("Provider name").fill("IT registration pending");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("status")).toHaveText("Draft saved");await expect(page.getByRole("button",{name:"Check discovery"})).toBeDisabled();await expect(page.getByText("Saved client secret: Not configured")).toBeVisible();
  await expect(page.getByRole("button",{name:"Check discovery"})).toHaveAccessibleDescription("Discovery requires a name, HTTPS issuer, client ID, openid scope, display name claim and client secret.");
});

for(const width of [390,1440])test(`saved OIDC login test binds the displayed revision and launches only a healthy unchanged draft at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/__oidc-test',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,active:null,draft:{...draft,discoveryHealth:'healthy'},test:{revision:1,result:'succeeded',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()}}}));
  let reauthenticated=false;
  await page.route('**/api/sessions/reauthenticate',route=>{expect(route.request().headers()['x-csrf-token']).toBe('csrf');reauthenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
  await page.route('**/api/admin/authentication/oidc/test',route=>{expect(reauthenticated).toBe(false);expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({expectedRevision:1});return route.fulfill({json:{authorizationUrl:'https://idp.example.org/authorize'}});});
  await page.route('https://idp.example.org/authorize',route=>route.fulfill({contentType:'text/html',body:'Controlled provider authorization'}));
  page.on('dialog',dialog=>{throw new Error(`Saved OIDC draft unexpectedly prompted: ${dialog.type()}`);});
  await page.goto('/__oidc-test');await expect(page.getByText('Revision 1: Identity validated. S256 PKCE: Yes.')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Test provider login'})).toBeEnabled();

  await page.getByLabel('Provider name').fill('Unsaved changed provider');await expect(page.getByRole('button',{name:'Test provider login'})).toHaveCount(0);
  await page.getByLabel('Provider name').fill(draft.name);await page.getByRole('button',{name:'Test provider login'}).click();await expect(page).toHaveURL('https://idp.example.org/authorize');
});

for(const language of ['en','sv'])test(`OIDC failures provide sanitized actionable guidance in ${language}`,async({page})=>{
  await page.route('**/__oidc-errors*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,test:{revision:1,result:'failed',failureCode:'expired',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()}}}));
  await page.goto('/__oidc-errors?readonly=1');
  await expect(page.getByRole('alert')).toHaveText(language==='sv'?'Testet har gått ut. Starta ett nytt test.':'The test expired. Start a new test.');
  await expect(page.getByText(language==='sv'?'Aktiv leverantör: Active identity provider':'Active provider: Active identity provider')).toBeVisible();
});

for(const language of ['en','sv'])for(const width of [390,1440])test(`tested SSO activation retains previous policy on stale activation in ${language} at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/__oidc-activation',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 const testId='a'.repeat(64);let state={...initial,active:null as typeof initial.active|null,draft:{...draft,discoveryHealth:'healthy'},test:{testId,revision:1,result:'succeeded',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()}};
 let fail=true,proof=false;
 await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:state}));
 await page.route('**/api/sessions/reauthenticate',route=>{proof=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
 await page.route('**/api/admin/authentication/oidc/activate',route=>{expect(proof).toBe(false);expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({expectedRevision:1,testId});if(fail)return route.fulfill({status:409,json:{code:'admin.oidcActivationTestRequired'}});state={...state,active:state.draft};return route.fulfill({json:state});});
 await page.goto('/__oidc-activation');const button=page.getByRole('button',{name:language==='sv'?'Aktivera testad SSO':'Activate tested SSO',exact:true});await expect(button).toBeEnabled();
 await expect(page.getByText(language==='sv'?/Aktivering stoppar nya vanliga lösenordsinloggningar/:/Activation stops new ordinary password logins/)).toHaveCount(0);
 await button.click();await expect(page.getByRole('alert')).toContainText(language==='sv'?'Föregående policy gäller fortfarande':'The previous policy remains active');
 await expect(page.getByText(language==='sv'?'Aktiv leverantör: Lokal inloggning':'Active provider: Local login',{exact:true})).toBeVisible();
 fail=false;await button.click();await expect(page.getByRole('status').filter({hasText:language==='sv'?'SSO aktiverad.':'SSO activated.'})).toBeVisible();await expect(button).toHaveCount(0);
 await expect(page.getByText(language==='sv'?`Aktiv leverantör: ${draft.name}`:`Active provider: ${draft.name}`,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

for(const language of ['en','sv'])for(const width of [390,1440])test(`integration acknowledgment remains usable and scoped to the displayed revisions without history in ${language} at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/__oidc-rotation',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 const testId='b'.repeat(64),actor='Responsible administrator';
 let state={...initial,draft:{...draft,revision:2,issuer:'https://replacement.example.org',discoveryHealth:'healthy'},identityImpact:{integrationChanged:true,activeRevision:1,draftRevision:2,linkedIdentities:14},test:{testId,revision:2,result:'succeeded',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()},
  history:[{revision:2,createdAt:new Date().toISOString(),actorId:'stable-actor-id',actorName:actor,credentialConfigured:true,discoveryHealth:'healthy',status:'draft',changedFields:['issuer','clientId'],credentialReplaced:true},{revision:1,createdAt:new Date().toISOString(),actorId:'stable-actor-id',actorName:actor,credentialConfigured:true,discoveryHealth:'healthy',status:'active',changedFields:['name'],credentialReplaced:false}],activationHistory:[{revision:1,result:'succeeded',actorId:'stable-actor-id',actorName:actor,occurredAt:new Date().toISOString()}]};
 await page.route('**/api/admin/authentication/oidc',route=>{
  if(route.request().method()==='PUT'){
   expect(route.request().postDataJSON()).toEqual({expectedRevision:2,copyActiveRevision:3});
   state={...state,draft:{...state.active,revision:4,discoveryHealth:'unchecked'},test:null as unknown as typeof state.test,identityImpact:{...state.identityImpact,integrationChanged:false,draftRevision:4}};
  }
  return route.fulfill({json:state});
 });
 await page.route('**/api/sessions/reauthenticate',route=>route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}}));
 let activationCalls=0;
 await page.route('**/api/admin/authentication/oidc/activate',route=>{activationCalls++;expect(route.request().postDataJSON()).toEqual({expectedRevision:2,testId,identityChangeAcknowledgment:{activeRevision:1,draftRevision:2}});return route.fulfill({status:409,json:{code:'admin.oidcIdentityAcknowledgmentRequired'}});});
 await page.goto('/__oidc-rotation');
 await expect(page.getByRole('heading',{name:language==='sv'?'Versionshistorik':'Version history',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:language==='sv'?'Aktiveringshistorik':'Activation history',exact:true})).toHaveCount(0);
 await expect(page.getByText(actor)).toHaveCount(0);await expect(page.getByText('stable-actor-id')).toHaveCount(0);
 const acknowledgment=page.getByRole('checkbox',{name:language==='sv'?/Jag förstår att ersättningen/:/I understand that the replacement/});const button=page.getByRole('button',{name:language==='sv'?'Aktivera testad SSO':'Activate tested SSO',exact:true});
 await expect(button).toBeDisabled();await acknowledgment.check();await expect(button).toBeEnabled();
 await page.getByLabel(language==='sv'?'Leverantörens namn':'Provider name').fill('Unsaved replacement');await expect(button).toHaveCount(0);await page.getByLabel(language==='sv'?'Leverantörens namn':'Provider name').fill(draft.name);
 await button.click();await expect(page.getByRole('alert')).toContainText(language==='sv'?'tidigare integrationen förblir aktiv':'previous integration remains active');expect(activationCalls).toBe(1);
 // A reload onto another active revision must clear the previous consent.
 state={...state,active:{...state.active,revision:3},identityImpact:{...state.identityImpact,activeRevision:3}};
 await page.getByRole('button',{name:language==='sv'?'Läs om OIDC-utkast':'Reload OIDC draft',exact:true}).click();await expect(acknowledgment).not.toBeChecked();
 await page.getByRole('button',{name:language==='sv'?'Kopiera aktiv konfiguration till nytt utkast':'Copy active configuration to new draft',exact:true}).click();await expect(page.getByLabel(language==='sv'?'Utfärdaradress':'Issuer address')).toHaveValue(draft.issuer);await expect(button).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/auth012-integration-${language}-${width}.png`,fullPage:true});
});

for(const language of ['en','sv'])test(`missing activation evidence offers an unchanged replacement draft through independent recovery in ${language}`,async({page})=>{
 await page.route('**/__oidc-prepare',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 let state={...initial,active:draft,activeSnapshotReady:false};
 await page.route('**/api/sessions/reauthenticate',route=>route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}}));
 await page.route('**/api/admin/authentication/oidc',route=>{
  if(route.request().method()==='PUT'){const body=route.request().postDataJSON();expect(body).toEqual({expectedRevision:1,copyActiveRevision:1});expect(body).not.toHaveProperty('replacementSecret');state={...state,draft:{...draft,revision:2,discoveryHealth:'unchecked'}};}
  return route.fulfill({json:state});
 });
 await page.goto('/__oidc-prepare');await expect(page.getByRole('alert')).toContainText(language==='sv'?'saknar en godkänd discoverybild':'no approved discovery snapshot');await expect(page.getByRole('button',{name:language==='sv'?'Spara OIDC-utkast':'Save OIDC draft',exact:true})).toBeDisabled();
 const prepare=page.getByRole('button',{name:language==='sv'?'Kopiera aktiv konfiguration till nytt utkast':'Copy active configuration to new draft',exact:true});await expect(prepare).toBeEnabled();await prepare.click();await expect(page.getByRole('status')).toHaveText(language==='sv'?'Utkast sparat':'Draft saved');await expect(prepare).toBeEnabled();await expect(page.getByRole('button',{name:language==='sv'?'Aktivera testad SSO':'Activate tested SSO',exact:true})).toHaveCount(0);await expect(page.getByText(language==='sv'?'Aktiv revision: 1':'Active revision: 1')).toBeVisible();
});

for(const language of ['en','sv'])test(`a legacy draft with identical visible settings can restore its active identity namespace through a fresh draft in ${language}`,async({page})=>{
 await page.route('**/__oidc-legacy',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 let state={...initial,active:draft,draft:{...draft,revision:2},activeSnapshotReady:true,identityImpact:{integrationChanged:true,activeRevision:1,draftRevision:2,linkedIdentities:14}};
 await page.route('**/api/sessions/reauthenticate',route=>route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}}));
 await page.route('**/api/admin/authentication/oidc',route=>{
  if(route.request().method()==='PUT'){const body=route.request().postDataJSON();expect(body).toEqual({expectedRevision:2,copyActiveRevision:1});expect(body).not.toHaveProperty('replacementSecret');state={...state,draft:{...draft,revision:3,discoveryHealth:'unchecked'},identityImpact:{...state.identityImpact,integrationChanged:false,draftRevision:3}};}
  return route.fulfill({json:state});
 });
 await page.goto('/__oidc-legacy');await expect(page.getByText(language==='sv'?/Befintliga externa identitetskopplingar tillhör/:/Existing external identity links stay/)).toBeVisible();await expect(page.getByRole('button',{name:language==='sv'?'Spara OIDC-utkast':'Save OIDC draft',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:language==='sv'?'Kopiera aktiv konfiguration till nytt utkast':'Copy active configuration to new draft',exact:true}).click();await expect(page.getByRole('status')).toHaveText(language==='sv'?'Utkast sparat':'Draft saved');await expect(page.getByRole('checkbox',{name:language==='sv'?/Jag förstår att ersättningen/:/I understand that the replacement/})).toHaveCount(0);await expect(page.getByRole('button',{name:language==='sv'?'Aktivera testad SSO':'Activate tested SSO',exact:true})).toHaveCount(0);
});

for(const language of ['en','sv'])test(`agency OIDC proof, private origins and protected key rotation are managed in Authentication in ${language}`,async({page})=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 await page.route('**/__oidc-settings',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 let saved={...initial,credentialKeyVersion:1};
 await page.route('**/api/admin/authentication/oidc',route=>{
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();
   expect(body.mappings.username).toBe('preferred_username');
   expect(body.personalProof).toEqual({id:'agency-personal-contract-v1',acr:null,requiredAmr:['pwd']});
   expect(body.privateOrigins).toEqual(['https://internal.example.org']);
   saved={...saved,draft:{...draft,...body,revision:2}};
  }
  return route.fulfill({json:saved});
 });
 await page.route('**/api/sessions/reauthenticate',route=>route.fulfill({json:{reauthenticatedUntil:'2099-01-01T00:00:00Z'}}));
 await page.route('**/api/admin/authentication/oidc/keys/rotate',route=>{
  expect(route.request().postDataJSON()).toEqual({expectedVersion:1});expect(route.request().headers()['x-csrf-token']).toBe('csrf');
  saved={...saved,credentialKeyVersion:2};return route.fulfill({json:saved});
 });
 await page.goto('/__oidc-settings');
 const messages=language==='sv'?sv:en;
 await expect(page.getByLabel(t('Provider name','Leverantörens namn'))).toHaveValue(draft.name);
 await expect(page.getByLabel(messages['admin.oidcUsernameClaim'])).toHaveValue('preferred_username');
 for(const key of ['admin.oidcRegistrationHelp','admin.oidcDraftHelp','admin.oidcPersonalProofHelp','admin.oidcPrivateOriginsHelp','admin.oidcCredentialKeyHelp','admin.oidcActivationHelp','admin.oidcRotationHelp','admin.oidcDiagnosticHelp','admin.oidcProtocolHelp','admin.oidcTestTitle','admin.oidcRequiredClaims','admin.oidcIdentityPending'] as const){
  await expect(page.getByText(messages[key],{exact:true})).toHaveCount(0);
 }
 const registration=page.getByRole('region',{name:messages['admin.oidcRegistrationTitle']});
 await expect(registration).toBeVisible();
 await expect(registration.getByText(messages['admin.oidcItSetupHelp'],{exact:true})).toBeVisible();
 await expect(registration.getByText(messages['admin.oidcItProofHelp'],{exact:true})).toBeVisible();
 await expect(registration.getByText('iss, sub, aud, exp, iat, nonce',{exact:true})).toBeVisible();
 await expect(registration.getByLabel(messages['admin.oidcCallback'],{exact:true})).toHaveValue(initial.registration.hosts[0]!.callbackUrl);
 await expect(page.getByText(messages['admin.oidcDiscoveryTitle'],{exact:true})).toHaveCount(0);
 await expect(page.getByText(messages['admin.oidcHealth']+': '+messages['admin.oidcHealthUnchecked'],{exact:true})).toHaveCount(0);
 await expect(registration.getByText(initial.registration.hosts[0]!.origin,{exact:true})).toHaveCount(0);
 await expect(page.getByLabel(messages['admin.oidcLogoutCallback'],{exact:true})).toHaveCount(0);
 await expect(page.getByText(messages['admin.oidcGroupScope'].replace('{name}','Test Agency').replace('{count}','1'),{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:messages['admin.oidcReload'],exact:true})).toHaveCount(0);
 await page.getByLabel(t('Approve this provider for personal authentication','Godkänn leverantören för personlig autentisering')).check();
 await page.getByLabel(t('Require a specific authentication context (ACR)','Kräv en specifik autentiseringskontext (ACR)')).uncheck();
 await page.getByLabel(t('Required authentication methods (AMR, space separated)','Krävda autentiseringsmetoder (AMR, blankstegsseparerade)')).fill('pwd');
 await page.getByLabel(t('Private provider HTTPS origins (optional, one per line)','Privata HTTPS-ursprung för leverantören (valfritt, ett per rad)')).fill('https://internal.example.org');

 const rotate=page.getByRole('button',{name:t('Rotate encryption key','Rotera krypteringsnyckel'),exact:true});
 await expect(rotate).toBeDisabled();
 await page.getByRole('button',{name:t('Save OIDC draft','Spara OIDC-utkast'),exact:true}).click();
 await expect(page.getByRole('status')).toHaveText(t('Draft saved','Utkast sparat'));
 await expect(rotate).toBeEnabled();await rotate.click();
 await expect(page.getByText(t('Agency encryption key version: 2','Organisationens krypteringsnyckelversion: 2'),{exact:true})).toBeVisible();

 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/agency-oidc-settings-${language}-${width}.png`,fullPage:true});}
});

for(const language of ['en','sv'])test(`OIDC provider tests explain a different selected agency host in ${language}`,async({page})=>{
 await page.route('**/__oidc-origin',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,active:null,draft:{...draft,discoveryHealth:'healthy'}}}));
 await page.route('**/api/sessions/reauthenticate',route=>route.fulfill({json:{reauthenticatedUntil:'2099-01-01T00:00:00Z'}}));
 await page.route('**/api/admin/authentication/oidc/test',route=>route.fulfill({status:401,json:{code:'admin.oidcAgencyOriginRequired'}}));
 await page.goto('/__oidc-origin');

 await page.getByRole('button',{name:language==='sv'?'Testa leverantörsinloggning':'Test provider login',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText(language==='sv'?'Öppna den valda organisationens registrerade adress och logga in där innan du testar OIDC. Att byta organisation i Administration ändrar inte webbläsarens adress.':'Open the selected agency’s registered address and sign in there before testing OIDC. Switching agency within Administration does not change the browser address.');
});

for(const language of ['en','sv'])for(const width of [390,1440])test(`copy active and show only the next SSO activation action in ${language} at ${width}px`,async({page})=>{
 const messages=language==='sv'?sv:en;
 const button=(key:'admin.oidcInspect'|'admin.oidcTest'|'admin.oidcActivate'|'admin.oidcCopyActive'|'admin.oidcCancel')=>page.getByRole('button',{name:messages[key],exact:true});
 await page.setViewportSize({width,height:900});
 await page.route('**/__oidc-steps',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 type State=typeof initial & {test?:{testId:string;revision:number;result:string}|null};
 let state:State={...initial,draft:{...draft,revision:2,name:'Abandoned replacement',issuer:'https://replacement.example.org'}};
 let copies=0,copyFails=true,discoveryFails=true;
 await page.route('**/api/admin/authentication/oidc',route=>{
  if(route.request().method()==='PUT'){
   copies++;expect(route.request().headers()['x-csrf-token']).toBe('csrf');
   expect(route.request().postDataJSON()).toEqual({expectedRevision:state.draft.revision,copyActiveRevision:1});
   if(copyFails)return route.fulfill({status:409,json:{code:'admin.oidcStale'}});
   state={...state,draft:{...state.active,revision:state.draft.revision+1,discoveryHealth:'unchecked'},test:null};
  }
  return route.fulfill({json:state});
 });
 await page.route('**/api/admin/authentication/oidc/discovery',route=>{
  expect(route.request().postDataJSON()).toEqual({expectedRevision:3});
  state={...state,draft:{...state.draft,discoveryHealth:discoveryFails?'failed':'healthy'}};
  return route.fulfill({json:state});
 });
 await page.route('**/api/admin/authentication/oidc/test',route=>{
  expect(route.request().postDataJSON()).toEqual({expectedRevision:3});
  state={...state,test:{testId:'c'.repeat(64),revision:3,result:state.test?.result==='failed'?'succeeded':'failed'}};
  return route.fulfill({json:{authorizationUrl:'/__oidc-steps'}});
 });
 await page.route('**/api/admin/authentication/oidc/activate',route=>{
  expect(route.request().postDataJSON()).toEqual({expectedRevision:3,testId:'c'.repeat(64)});
  state={...state,active:state.draft};return route.fulfill({json:state});
 });
 const expectStep=async(key:'admin.oidcInspect'|'admin.oidcTest'|'admin.oidcActivate'|null)=>{
  for(const step of ['admin.oidcInspect','admin.oidcTest','admin.oidcActivate'] as const)await expect(button(step)).toHaveCount(step===key?1:0);
 };
 await page.goto('/__oidc-steps');
 await expect(button('admin.oidcCancel')).toHaveCount(0);
 await expectStep('admin.oidcInspect');
 const name=page.getByLabel(messages['admin.oidcName']);
 await name.fill('Unsaved change');await expectStep(null);
 page.once('dialog',dialog=>dialog.dismiss());await button('admin.oidcCopyActive').click();expect(copies).toBe(0);await expect(name).toHaveValue('Unsaved change');
 page.once('dialog',dialog=>dialog.accept());await button('admin.oidcCopyActive').click();await expect(page.getByRole('alert')).toBeVisible();await expect(name).toHaveValue('Unsaved change');
 copyFails=false;page.once('dialog',dialog=>dialog.accept());await button('admin.oidcCopyActive').click();await expect(page.getByRole('status')).toHaveText(messages['admin.oidcDraftSaved']);
 await expect(name).toHaveValue(initial.active.name);await expect(page.getByLabel(messages['admin.oidcIssuer'])).toHaveValue(initial.active.issuer);await expectStep('admin.oidcInspect');
 await button('admin.oidcInspect').click();await expect(page.getByRole('status')).toHaveText(messages['admin.oidcDiscoveryFailed']);await expectStep('admin.oidcInspect');
 discoveryFails=false;await button('admin.oidcInspect').click();await expectStep('admin.oidcTest');
 await button('admin.oidcTest').click();await expectStep('admin.oidcTest');
 await button('admin.oidcTest').click();await expectStep('admin.oidcActivate');
 await page.screenshot({path:`/tmp/oidc-next-action-${language}-${width}.png`,fullPage:true});
 await button('admin.oidcActivate').click();await expect(page.getByRole('status')).toHaveText(messages['admin.oidcActivated']);await expectStep(null);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const language of ['en','sv'])test(`canceling the provider redirect keeps OIDC controls usable in ${language}`,async({page})=>{
 const messages=language==='sv'?sv:en;
 await page.route('**/__oidc-canceled-redirect',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
 await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,active:null,draft:{...draft,discoveryHealth:'healthy'}}}));
 let attempts=0;
 await page.route('**/api/admin/authentication/oidc/test',route=>{
  attempts++;expect(route.request().postDataJSON()).toEqual({expectedRevision:1});
  return route.fulfill({json:{authorizationUrl:'https://idp.example.org/authorize'}});
 });
 await page.route('https://idp.example.org/authorize',route=>route.fulfill({contentType:'text/html',body:'Controlled provider authorization'}));
 await page.goto('/__oidc-canceled-redirect');
 const button=page.getByRole('button',{name:messages['admin.oidcTest'],exact:true});
 await expect(button).toBeEnabled();
 // Another mounted Admin editor can legitimately protect its unsaved changes.
 await page.evaluate(()=>window.addEventListener('beforeunload',event=>{event.preventDefault();event.returnValue='';}));
 let warnings=0;
 page.on('dialog',async dialog=>{expect(dialog.type()).toBe('beforeunload');warnings++;await dialog.dismiss();});
 await button.click();await expect.poll(()=>warnings).toBe(1);
 await expect(page).toHaveURL(/__oidc-canceled-redirect$/);
 await expect(button).toBeEnabled();await expect(page.getByLabel(messages['admin.oidcName'])).toBeEnabled();
 // Canceling twice must still allow retrying, without a reload or duplicate starts.
 await button.click();await expect.poll(()=>warnings).toBe(2);await expect(button).toBeEnabled();expect(attempts).toBe(2);
 page.removeAllListeners('dialog');page.once('dialog',async dialog=>{expect(dialog.type()).toBe('beforeunload');await dialog.accept();});
 await button.click();await expect(page).toHaveURL('https://idp.example.org/authorize');expect(attempts).toBe(3);
});
