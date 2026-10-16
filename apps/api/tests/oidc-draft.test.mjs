import assert from 'node:assert/strict';
import test from 'node:test';
import {registeredAgencyOrigin} from '../dist/sessions/agency-directory.service.js';
import { randomBytes } from 'node:crypto';
import { validateOidcDraft,missingOidcFields } from '../dist/authentication/oidc-draft.service.js';
import { encryptCredential,decryptCredential } from '../dist/authentication/oidc-credentials.js';
import { permittedAddress,checkedAddress,providerUrl,providerJson } from '../dist/authentication/oidc-network.js';
const input={expectedRevision:0,name:'Regional AD FS',issuer:'https://idp.example.org/adfs',discoveryUrl:'',clientId:'registration-from-IT',scopes:['openid','profile'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post'};
test('OIDC drafts permit incomplete values but reject forged scopes and unsafe URLs',()=>{
  assert.equal(validateOidcDraft(input).configuration.issuer,input.issuer);
  assert.equal(validateOidcDraft({...input,mappings:{displayName:"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",email:"email"}}).configuration.mappings.displayName,"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name");
  assert.deepEqual(missingOidcFields(validateOidcDraft({...input,name:'',clientId:''}).configuration,false),['name','clientId','credential']);
  for(const mutation of [{groupId:'foreign'},{expectedRevision:1.2},{issuer:'http://idp.example.org'},{issuer:'https://secret@idp.example.org'},{discoveryUrl:'https://idp.example.org/?secret=abc'},{scopes:['openid','a\nb']},{mappings:{displayName:'name',email:'email',roles:'roles'}},{clientAuthentication:'none'},{replacementSecret:''}]) assert.throws(()=>validateOidcDraft({...input,...mutation}));
});
test('credentials authenticate group, provider and key version with independent installation keys',()=>{
  const old=process.env.OIDC_CREDENTIAL_KEYS_JSON;const version=process.env.OIDC_CREDENTIAL_KEY_VERSION;
  try{process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64'),'2':randomBytes(32).toString('base64')});process.env.OIDC_CREDENTIAL_KEY_VERSION='1';
    const a=encryptCredential('client secret from regional IT','group','provider');const b=encryptCredential('client secret from regional IT','group','provider');
    assert.notDeepEqual(a,b);assert.equal(decryptCredential(a,'group','provider'),'client secret from regional IT');assert.doesNotMatch(JSON.stringify(a),/client secret/);
    for(const args of [[a,'foreign','provider'],[a,'group','foreign'],[{...a,version:'2'},'group','provider']]) assert.throws(()=>decryptCredential(...args));
    process.env.OIDC_CREDENTIAL_KEY_VERSION='2';assert.equal(encryptCredential('rotated','group','provider').version,'2');assert.equal(decryptCredential(a,'group','provider'),'client secret from regional IT');
    process.env.OIDC_CREDENTIAL_KEYS_JSON='{sensitive-key';assert.throws(()=>encryptCredential('secret','group','provider'),error=>error.message==='OIDC credential encryption is unavailable');
    process.env.OIDC_CREDENTIAL_KEYS_JSON='{}';assert.throws(()=>encryptCredential('secret','group','provider'),/unavailable/);
  }finally{if(old===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=old;if(version===undefined)delete process.env.OIDC_CREDENTIAL_KEY_VERSION;else process.env.OIDC_CREDENTIAL_KEY_VERSION=version;}
});
test('outbound policy blocks reserved IPv4, IPv6, mapped and transition addresses even with private hosting consent',async()=>{
  for(const address of ['127.0.0.1','0.0.0.0','169.254.169.254','100.100.100.200','224.0.0.1','192.0.2.1','::','::1','fe80::1','ff02::1','::ffff:127.0.0.1','::ffff:169.254.169.254','2002:7f00:1::','64:ff9b::7f00:1']) for(const allow of [false,true]) assert.equal(permittedAddress(address,allow),false,address);
  for(const address of ['10.1.1.1','172.16.0.1','192.168.1.1','fd00::1','::ffff:10.1.1.1']){assert.equal(permittedAddress(address),false);assert.equal(permittedAddress(address,true),true);}
  assert.equal(permittedAddress('8.8.8.8'),true);assert.equal(permittedAddress('2606:4700:4700::1111'),true);
  const old=process.env.OIDC_PRIVATE_ORIGINS_JSON;
  try{process.env.OIDC_PRIVATE_ORIGINS_JSON='["https://regional.example.org"]';const resolver=async()=>[{address:'10.1.1.1',family:4}];
    assert.equal((await checkedAddress(providerUrl('https://regional.example.org/adfs'),resolver,['https://regional.example.org'])).address,'10.1.1.1');
    await assert.rejects(checkedAddress(providerUrl('https://regional.example.org/adfs'),resolver),/Unsafe/);
    await assert.rejects(checkedAddress(providerUrl('https://other.example.org'),resolver,['https://regional.example.org']),/Unsafe/);
    await assert.rejects(checkedAddress(providerUrl('https://regional.example.org'),async()=>[{address:'10.1.1.1',family:4},{address:'169.254.169.254',family:4}]),/Unsafe/);
    await assert.rejects(providerJson('https://127.0.0.1/.well-known/openid-configuration'),/Unsafe/);
  }finally{if(old===undefined)delete process.env.OIDC_PRIVATE_ORIGINS_JSON;else process.env.OIDC_PRIVATE_ORIGINS_JSON=old;}
});

test('agency OIDC drafts validate proof requirements and exact private origins without accepting forged integration bindings',()=>{
 const personalProof={id:'agency-contract',acr:null,requiredAmr:['pwd']};
 assert.deepEqual(validateOidcDraft({...input,personalProof,privateOrigins:['https://private.example.org']}).configuration.personalProof,personalProof);
 for(const mutation of [{personalProof:{...personalProof,groupId:'other'}},{personalProof:{...personalProof,acr:undefined}},{personalProof:{...personalProof,requiredAmr:[]}},{personalProof:[]},{personalProof:'enabled'},{privateOrigins:['http://internal.example']},{privateOrigins:['https://internal.example/path']},{privateOrigins:'https://internal.example'}])assert.throws(()=>validateOidcDraft({...input,...mutation}));
});
test('agency private-origin approval does not inherit another group or installation allowlist',async()=>{
 const old=process.env.OIDC_PRIVATE_ORIGINS_JSON;
 try{
  process.env.OIDC_PRIVATE_ORIGINS_JSON='["https://regional.example.org"]';
  const url=providerUrl('https://regional.example.org/adfs'),resolver=async()=>[{address:'10.1.1.1',family:4}];
  await assert.rejects(checkedAddress(url,resolver,[]));
  assert.equal((await checkedAddress(url,resolver,['https://regional.example.org'])).address,'10.1.1.1');
  await assert.rejects(checkedAddress(url,async()=>[{address:'127.0.0.1',family:4}],['https://regional.example.org']));
 }finally{if(old===undefined)delete process.env.OIDC_PRIVATE_ORIGINS_JSON;else process.env.OIDC_PRIVATE_ORIGINS_JSON=old;}
});

test('registration URLs use the accepted localhost port in development and HTTPS in production',()=>{
 assert.equal(registeredAgencyOrigin('test.localhost',{NODE_ENV:'development',WEB_ORIGIN:'http://localhost:3000'}),'http://test.localhost:3000');
 assert.equal(registeredAgencyOrigin('test.localhost',{NODE_ENV:'development',WEB_ORIGIN:'http://localhost:3198'}),'http://test.localhost:3198');
 assert.equal(registeredAgencyOrigin('agency.example.org',{NODE_ENV:'development',WEB_ORIGIN:'http://localhost:3000'}),'https://agency.example.org');
 assert.equal(registeredAgencyOrigin('test.localhost',{NODE_ENV:'production',WEB_ORIGIN:'http://localhost:3000'}),'https://test.localhost');
});

test('copying active OIDC settings preserves the active credential even when the same integration has a different staged secret',async()=>{
 const {OidcDraftService}=await import('../dist/authentication/oidc-draft.service.js');
 const active={provider_id:'active-provider',configuration:{...validateOidcDraft(input).configuration,personalProof:null,privateOrigins:['https://private.example.org']},encrypted_credential:{ciphertext:'protected-active-secret'}};
 let state={draft_revision:'2',active_revision:'1'},inserted;
 const writes=[];
 const manager={query:async(sql,args)=>{
  if(sql.includes('select clock_timestamp()'))return [{now:new Date()}];
  if(sql.includes('organization_group'))return [{group_id:'group'}];
  if(sql.includes('clock_timestamp()'))return [{now:new Date()}];
  if(sql.includes('select draft_revision,active_revision'))return [state];
  if(sql.includes('select provider_id,configuration,encrypted_credential'))return [args[1]==='1'?active:{...active,configuration:{...active.configuration,name:'Abandoned draft'},encrypted_credential:{ciphertext:'different-staged-secret'}}];
  if(sql.includes('select version,encrypted_key'))return [{version:1}];
  if(sql.startsWith('insert into app_identity.oidc_provider_version'))inserted=args;
  if(sql.startsWith('insert'))writes.push(sql);
  return [];
 }};
 const sessions={requireCapability:async(token,capability,tx)=>{assert.equal(token,'session');assert.equal(capability,'settings:write');assert.equal(tx,manager);return {organization:{id:'agency'},user:{id:'actor'}};}};
 const service=new OidcDraftService({transaction:work=>work(manager)},sessions);
 service.get=async()=>({masked:true});
 assert.deepEqual(await service.save('session',{expectedRevision:2,copyActiveRevision:1}),{masked:true});
 assert.deepEqual(inserted.slice(0,3),['group',3,'active-provider']);
 assert.deepEqual(JSON.parse(inserted[3]),active.configuration);
 assert.deepEqual(JSON.parse(inserted[4]),active.encrypted_credential);
 assert.equal(writes.some(sql=>sql.includes('active_revision')),false);
 assert.equal(writes.some(sql=>sql.includes('discovery')),false);
 const writeCount=writes.length;
 for(const body of [{expectedRevision:1,copyActiveRevision:1},{expectedRevision:2,copyActiveRevision:3}]){
  await assert.rejects(service.save('session',body),e=>e.getResponse?.().code==='admin.oidcStale');
 }
 state={draft_revision:'2',active_revision:null};
 await assert.rejects(service.save('session',{expectedRevision:2,copyActiveRevision:1}),e=>e.getResponse?.().code==='admin.oidcStale');
 for(const body of [{expectedRevision:2,copyActiveRevision:0},{expectedRevision:2.5,copyActiveRevision:1},{expectedRevision:2,copyActiveRevision:'1'},{expectedRevision:2,copyActiveRevision:1,replacementSecret:'forged'},{expectedRevision:2,copyActiveRevision:1,groupId:'foreign'}]){
  await assert.rejects(service.save('session',body),e=>e.getResponse?.().code==='admin.oidcInvalid');
 }
 assert.equal(writes.length,writeCount,'rejected copies must not save or activate anything');
});

test('OIDC username claim mapping is optional and rejects malformed configuration',()=>{
 assert.equal(validateOidcDraft({...input,mappings:{...input.mappings,username:'preferred_username'}}).configuration.mappings.username,'preferred_username');
 assert.equal(validateOidcDraft({...input,mappings:{...input.mappings,username:''}}).configuration.mappings.username,'');
 for(const username of [null,42,[],{},'two claims','bad\nclaim','x'.repeat(257)])assert.throws(()=>validateOidcDraft({...input,mappings:{...input.mappings,username}}));
});
