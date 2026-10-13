import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { enrollmentInput } from '../dist/admin/installation-enrollment.service.js';
import { installationCredential,InstallationEnrollmentController } from '../dist/admin/installation-enrollment.controller.js';
import { CsrfGuard } from '../dist/sessions/csrf.guard.js';
const token=randomBytes(32).toString('base64url');
test('enrollment validates explicit context confirmation and excludes user, agency, unit or role claims',()=>{
 assert.deepEqual(enrollmentInput({token,name:' Device ',confirmInstallation:true},true),{token,name:'Device'});
 for(const extra of [{confirmInstallation:false},{organizationId:'forged'},{userId:'forged'},{unitId:'forged'},{role:'admin'},{name:'\n'}, {token:'forged'}])
 assert.throws(()=>enrollmentInput({token,name:'Device',confirmInstallation:true,...extra},true));
 assert.throws(()=>enrollmentInput({token,name:'Device'},false));
});
test('only exact independent bootstrap POSTs with non-simple enrollment header bypass stale clinician-cookie CSRF',async()=>{
 let checks=0;
 const guard=new CsrfGuard({assertCsrf:async()=>{checks++;throw new Error('stale clinician cookie');}});
 const context=request=>({switchToHttp:()=>({getRequest:()=>request})});
 for(const path of ['/api/installations/preview','/api/installations/enroll'])
 assert.equal(await guard.canActivate(context({method:'POST',originalUrl:path,headers:{cookie:'open_triage_session=stale','x-installation-enrollment':'1'}})),true);
 assert.equal(checks,0);
 for(const path of ['/api/installations/enroll/extra','/api/admin/units/x/enrollment','/api/sessions/reauthenticate'])
 await assert.rejects(guard.canActivate(context({method:'POST',originalUrl:path,headers:{cookie:'open_triage_session=stale','x-installation-enrollment':'1'}})),/stale/);
 await assert.rejects(guard.canActivate(context({method:'POST',originalUrl:'/api/installations/enroll',headers:{cookie:'open_triage_session=stale'}})),/stale/);
});
test('independent HttpOnly installation cookie never returns its credential and survives clinician logout',async()=>{
 const writes=[];const installation={id:'i',name:'Browser'};
 const controller=new InstallationEnrollmentController({requireOrigin:async()=>{},consume:async(_body,cookie)=>{assert.equal(cookie,token);return {installation,credential:token};},current:async()=>installation});
 const response={cookie:(...args)=>writes.push(args)};
 assert.deepEqual(await controller.enroll({}, {headers:{cookie:`open_triage_installation=${token}; open_triage_session=stale`}},response),installation);
 assert.equal(writes[0][0],'open_triage_installation');
 assert.deepEqual(writes[0][2],{httpOnly:true,secure:true,sameSite:'strict',path:'/api',maxAge:31536000000});
 assert.equal(installationCredential('open_triage_installation=forged'),undefined);
 assert.deepEqual(await controller.current({headers:{cookie:`open_triage_installation=${token}`}},response),{enrolled:true,installation});
});

test('reassignment accepts only explicit confirmation and clears clinician cookie while rotating independent installation authority',async()=>{
 assert.deepEqual(enrollmentInput({token,name:'Browser',confirmInstallation:true,reassign:true},true),{token,name:'Browser',reassign:true});
 for(const reassign of [false,'true',null,1])assert.throws(()=>enrollmentInput({token,name:'Browser',confirmInstallation:true,reassign},true));
 const installation={id:'replacement',name:'Browser'},writes=[],cleared=[];
 const controller=new InstallationEnrollmentController({consume:async(_body,credential,clinician)=>{
 assert.equal(credential,token);assert.equal(clinician,'old-session');return {installation,credential:'B'.repeat(43),reassigned:true};
 }});
 const response={cookie:(...args)=>writes.push(args),clearCookie:(...args)=>cleared.push(args)};
 assert.deepEqual(await controller.enroll({reassign:true},{headers:{cookie:`open_triage_installation=${token}; open_triage_session=old-session`}},response),installation);
 assert.equal(writes[0][0],'open_triage_installation');assert.equal(writes[0][1],'B'.repeat(43));
 assert.deepEqual(cleared,[['open_triage_session',{httpOnly:true,secure:true,sameSite:'strict',path:'/api'}]]);
});
