import assert from 'node:assert/strict';
import test from 'node:test';
import {OidcPersonalController} from '../dist/authentication/oidc-personal.controller.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {UnauthorizedException} from '@nestjs/common';

test('compatibility sensitive-action authority accepts valid login without reading or renewing proof',async()=>{
 const service=new ClinicianSessionService({});let validated=0;
 service.getAuthenticated=async(token,now,allowLimited,manager)=>{assert.equal(token,'valid');assert.equal(allowLimited,false);validated++;};
 await service.requireRecentReauthentication('valid');assert.equal(validated,1);
 service.getAuthenticated=async()=>{throw new UnauthorizedException();};
 await assert.rejects(service.requireRecentReauthentication('revoked'),error=>error.getStatus()===401);
});
for(const personallyAuthenticatedAt of [undefined,'2000-01-01T00:00:00.000Z'])test(`legacy SSO compatibility uses valid session expiry without prompting (${personallyAuthenticatedAt})`,async()=>{
 const expiresAt='2099-01-01T00:00:00.000Z';let csrf=false;
 const controller=new OidcPersonalController({begin:async()=>{throw Error('Unexpected personal proof interaction');}},{
  assertCsrf:async()=>{csrf=true;},getAuthenticated:async()=>({authenticationSource:'oidc',expiresAt,personallyAuthenticatedAt})});
 assert.deepEqual(await controller.reauthenticate({currentPassword:''},{headers:{}},'csrf','Bearer valid',{}),{reauthenticatedUntil:expiresAt});
 assert.equal(csrf,true);
});
