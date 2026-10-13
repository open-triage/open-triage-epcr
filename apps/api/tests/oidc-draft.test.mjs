import assert from 'node:assert/strict';
import test from 'node:test';
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
    assert.equal((await checkedAddress(providerUrl('https://regional.example.org/adfs'),resolver)).address,'10.1.1.1');
    await assert.rejects(checkedAddress(providerUrl('https://other.example.org'),resolver),/Unsafe/);
    await assert.rejects(checkedAddress(providerUrl('https://regional.example.org'),async()=>[{address:'10.1.1.1',family:4},{address:'169.254.169.254',family:4}]),/Unsafe/);
    await assert.rejects(providerJson('https://127.0.0.1/.well-known/openid-configuration'),/Unsafe/);
  }finally{if(old===undefined)delete process.env.OIDC_PRIVATE_ORIGINS_JSON;else process.env.OIDC_PRIVATE_ORIGINS_JSON=old;}
});
