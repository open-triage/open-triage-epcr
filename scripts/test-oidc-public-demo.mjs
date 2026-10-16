// Explicit optional interoperability check; never invoked by CI.
// Only Duende's published disposable demo client and fictional identity are used.
import {chromium} from 'playwright';
import {randomBytes} from 'node:crypto';
import {providerJson} from '../apps/api/dist/authentication/oidc-network.js';
import {testAuthorization,testCodeExchange} from '../apps/api/dist/authentication/oidc-test-protocol.js';
const metadata=await providerJson('https://demo.duendesoftware.com/.well-known/openid-configuration');
const binding={state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),callback:'https://opentriage-test.invalid/api/sessions/oidc/callback',pkce:true};
const browser=await chromium.launch();let timer;
try{
 const page=await browser.newPage();page.setDefaultTimeout(20000);
 let resolve;const callback=new Promise(r=>resolve=r);
 page.on('request',request=>{if(request.isNavigationRequest()){const url=new URL(request.url());if(url.origin==='https://opentriage-test.invalid'&&url.pathname==='/api/sessions/oidc/callback')resolve(url);}});
 await page.route('https://opentriage-test.invalid/**',route=>route.fulfill({contentType:'text/plain',body:'Disposable protocol test complete.'}));
 await page.goto(await testAuthorization(metadata,'interactive.confidential','secret',['openid','profile'],binding));
 await page.locator('input[name="Input.Username"]').fill('alice');await page.locator('input[name="Input.Password"]').fill('alice');await page.getByRole('button',{name:'Login',exact:true}).click();
 const callbackUrl=await Promise.race([callback,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Public demo did not produce the expected callback navigation')),20000);})]);
 const result=await testCodeExchange(metadata,'interactive.confidential','secret',binding,callbackUrl);
 console.log(JSON.stringify({publicDemo:'Duende',callback:'captured browser navigation; no application callback/session',result,regionalAcceptance:false}));
}finally{clearTimeout(timer);await browser.close();}
