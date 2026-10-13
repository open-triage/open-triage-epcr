import { expect,test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
let script:string,css:string;
test.beforeAll(async()=>{
  css=await readFile(path.resolve(__dirname,"../app/styles.css"),"utf8");
  const result=await build({bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env":JSON.stringify({NEXT_PUBLIC_API_URL:"same-origin"})},stdin:{resolveDir:path.resolve(__dirname,".."),loader:"tsx",contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OidcDraftPanel} from './components/oidc-draft';createRoot(document.getElementById('root')).render(<OidcDraftPanel language={document.documentElement.lang} csrfToken="csrf" canWrite={!location.search.includes('readonly')}/>);`}});script=result.outputFiles[0]!.text;
});
const draft={revision:1,name:"Regional AD FS",issuer:"https://idp.example.org/adfs",discoveryUrl:"",clientId:"regional-client",scopes:["openid","profile"],mappings:{displayName:"name",email:"email"},credentialConfigured:true,requiredFields:[],discoveryHealth:"unchecked",discovery:null,discoveredAt:null};
const initial={groupId:"group",draft,active:{...draft,name:"Active regional provider"},registration:{hosts:[{origin:"https://agency.example.org",callbackUrl:"https://agency.example.org/api/sessions/oidc/callback",logoutCallbackUrl:"https://agency.example.org/api/sessions/oidc/logout-callback"}],requiredClaims:["iss","sub","aud","exp","iat","nonce"]},history:[]};
for(const width of [390,1440])test(`OIDC drafts mask credentials, retain active state on discovery failure and preserve edits at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route("**/__oidc",route=>route.fulfill({contentType:"text/html",body:`<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="admin-panel agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route("**/__oidc-script",route=>route.fulfill({contentType:"text/javascript",body:script}));
  let state=structuredClone(initial),saveFails=true,refreshFails=false,authenticated=false;
  await page.route("**/api/sessions/reauthenticate",route=>{expect(route.request().headers()["x-csrf-token"]).toBe("csrf");authenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
  await page.route("**/api/admin/authentication/oidc",route=>{
    if(route.request().method()==="PUT"){
      expect(authenticated).toBe(true);expect(route.request().headers()["x-csrf-token"]).toBe("csrf");const body=route.request().postDataJSON();expect(body).not.toHaveProperty("groupId");
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
  await page.getByLabel("Issuer address").fill("http://127.0.0.1");await page.getByLabel("Your password for OIDC changes").fill("Personal password 42!");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("alert")).toHaveText("Invalid OIDC field: issuer.");await expect(page.getByLabel("Issuer address")).toHaveValue("http://127.0.0.1");await page.getByLabel("Issuer address").fill(draft.issuer);
  await page.getByLabel("Provider name").fill("Changed draft");await page.getByLabel("Replacement client secret").fill("discarded-secret-on-failure");await page.getByLabel("Your password for OIDC changes").fill("Personal password 42!");await page.getByRole("button",{name:"Save OIDC draft"}).click();
  await expect(page.getByRole("alert")).toContainText("The OIDC draft changed");await expect(page.getByLabel("Provider name")).toHaveValue("Changed draft");await expect(page.getByLabel("Replacement client secret")).toHaveValue("");await expect(page.getByLabel("Your password for OIDC changes")).toHaveValue("");
  refreshFails=true;page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Reload OIDC draft"}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByLabel("Provider name")).toHaveValue("Changed draft");
  saveFails=false;await page.getByLabel("Replacement client secret").fill("new-client-secret");await page.getByLabel("Your password for OIDC changes").fill("Personal password 42!");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.getByLabel("Your password for OIDC changes").fill("Personal password 42!");await page.getByRole("button",{name:"Check discovery"}).click();await expect(page.getByRole("status")).toHaveText("Discovery failed. Active configuration retained.");await expect(page.getByText("Active provider: Active regional provider")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/oidc-draft-${width}.png`,fullPage:true});
});
test("Swedish read-only discovery metadata exposes no credential inputs and preserves exact registration",async({page})=>{
  await page.route("**/__oidc?*",route=>route.fulfill({contentType:"text/html",body:`<html lang="sv"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route("**/__oidc-script",route=>route.fulfill({contentType:"text/javascript",body:script}));
  await page.route("**/api/admin/authentication/oidc",route=>route.fulfill({json:{...initial,draft:{...draft,discoveryHealth:"healthy",discovery:{issuer:draft.issuer,signingKeyIds:["key-2026","key-2027"]}}}}));
  await page.goto("/__oidc?readonly=1");await expect(page.getByRole("heading",{name:"OIDC-leverantörens utkast"})).toBeVisible();await expect(page.getByLabel("Leverantörens namn")).toBeDisabled();await expect(page.locator('input[type="password"]')).toHaveCount(0);await expect(page.getByText("key-2026, key-2027")).toBeVisible();
});

test("a new OIDC draft leaves regional registration values for IT and can save an incomplete version",async({page})=>{
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
  await page.getByLabel("Provider name").fill("IT registration pending");await page.getByLabel("Your password for OIDC changes").fill("Personal password 42!");await page.getByRole("button",{name:"Save OIDC draft"}).click();await expect(page.getByRole("status")).toHaveText("Draft saved");await expect(page.getByRole("button",{name:"Check discovery"})).toBeDisabled();await expect(page.getByText("Saved client secret: Not configured")).toBeVisible();
});

for(const width of [390,1440])test(`saved OIDC login test binds the displayed revision and launches only a healthy unchanged draft at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/__oidc-test',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,draft:{...draft,discoveryHealth:'healthy'},test:{revision:1,result:'succeeded',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()}}}));
  let reauthenticated=false;
  await page.route('**/api/sessions/reauthenticate',route=>{expect(route.request().headers()['x-csrf-token']).toBe('csrf');reauthenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
  await page.route('**/api/admin/authentication/oidc/test',route=>{expect(reauthenticated).toBe(true);expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({expectedRevision:1});return route.fulfill({json:{authorizationUrl:'https://idp.example.org/authorize'}});});
  await page.route('https://idp.example.org/authorize',route=>route.fulfill({contentType:'text/html',body:'Controlled provider authorization'}));
  await page.goto('/__oidc-test');await expect(page.getByText('Revision 1: Identity validated. S256 PKCE: Yes.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Test provider login'})).toBeDisabled();
  await page.getByLabel('Your password for OIDC changes').fill('Personal password 42!');
  await page.getByLabel('Provider name').fill('Unsaved changed provider');await expect(page.getByRole('button',{name:'Test provider login'})).toBeDisabled();
  await page.getByLabel('Provider name').fill(draft.name);await page.getByRole('button',{name:'Test provider login'}).click();await expect(page).toHaveURL('https://idp.example.org/authorize');
});

for(const language of ['en','sv'])test(`OIDC failures provide sanitized actionable guidance in ${language}`,async({page})=>{
  await page.route('**/__oidc-errors*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__oidc-script"></script></body></html>`}));
  await page.route('**/__oidc-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/api/admin/authentication/oidc',route=>route.fulfill({json:{...initial,test:{revision:1,result:'failed',failureCode:'expired',pkceS256:true,freshPersonalAuthentication:false,completedAt:new Date().toISOString()}}}));
  await page.goto('/__oidc-errors?readonly=1');
  await expect(page.getByRole('alert')).toHaveText(language==='sv'?'Testet har gått ut. Bekräfta lösenordet och starta ett nytt test.':'The test expired. Confirm your password and start a new test.');
  await expect(page.getByText(language==='sv'?'Aktiv leverantör: Active regional provider':'Active provider: Active regional provider')).toBeVisible();
});
