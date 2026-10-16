import assert from 'node:assert/strict';
import test from 'node:test';
import {OidcTestService} from '../dist/authentication/oidc-test.service.js';
import {agencyRequest} from '../dist/sessions/agency-context.js';

test('OIDC diagnostics explain a mismatched registered agency host without creating a provider transaction',async()=>{
 let transactions=0;
 const manager={query:async()=>[{id:'shared-group'}]};
 const database={manager,query:async()=>{transactions++;return [];}};
 const sessions={requireCapability:async()=>({organization:{id:'selected-agency'}}),requireRecentReauthentication:async()=>{}};
 for(const hostAgency of [null,{id:'another-agency-in-the-same-group'}]){
  const service=new OidcTestService(database,sessions,{allowsOrigin:async()=>true,forLogin:async()=>hostAgency});
  await agencyRequest.run({origin:'http://demo.localhost:3000'},()=>assert.rejects(service.begin('valid-session',{expectedRevision:1}),error=>error.getStatus()===401&&error.getResponse().code==='admin.oidcAgencyOriginRequired'));
 }
 assert.equal(transactions,0);
 const service=new OidcTestService(database,sessions,{allowsOrigin:async()=>true,forLogin:async()=>({id:'selected-agency'})});
 await agencyRequest.run({origin:'http://test.localhost:3000'},()=>assert.rejects(service.begin('valid-session',{expectedRevision:1}),/provider draft changed/));
 assert.equal(transactions,1,'The correct agency host proceeds to draft validation');
});
test('OIDC diagnostics retain the origin gate with actionable errors for missing or unregistered origins',async()=>{
 const service=new OidcTestService({}, {}, {allowsOrigin:async()=>false});
 for(const context of [{},{origin:'https://unregistered.example.org'}])await agencyRequest.run(context,()=>assert.rejects(service.begin('token',{expectedRevision:1}),error=>error.getStatus()===401&&error.getResponse().code==='admin.oidcAgencyOriginRequired'));
});
