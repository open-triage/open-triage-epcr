import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoveryProvider} from './fixtures/oidc-discovery-provider.mjs';
const execute=promisify(execFile);
test('personal authorization and signed code exchange support explicit AMR-only contracts and retain ACR enforcement',async()=>{
 const fixture=await discoveryProvider();
 try{
  fixture.personalProofMode='fresh';fixture.tokenOverrides={acr:undefined,amr:['pwd']};
  const module=new URL('../dist/authentication/oidc-test-protocol.js',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';import {testAuthorization,personalCodeExchange} from ${JSON.stringify(module)};
   const origin=process.env.TEST_PROVIDER;
   const metadata={issuer:origin+'/adfs',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',id_token_signing_alg_values_supported:['RS256']};
   const policy={id:'reviewed-amr-contract',groupId:'group',providerId:'provider',issuer:metadata.issuer,clientId:'registered-client',acr:JSON.parse(process.env.TEST_ACR),requiredAmr:['pwd']};
   for(const purpose of ['login','switch','reauthenticate']){
    const began=new Date(Date.now()-2000);
    const binding={state:'state-'+purpose,nonce:'nonce-'+purpose,verifier:'verifier-with-enough-entropy-for-a-test',callback:'https://agency.example.org/api/sessions/oidc/callback',pkce:true};
    const url=new URL(await testAuthorization(metadata,policy.clientId,'fresh-provider-secret',['openid'],binding,{policy,purpose}));
    assert.equal(url.searchParams.get('prompt'),'login');assert.equal(url.searchParams.get('max_age'),'0');
    const claims=JSON.parse(url.searchParams.get('claims')).id_token;
    assert.deepEqual(claims.auth_time,{essential:true});assert.deepEqual(claims.amr,{essential:true});
    if(policy.acr===null){assert(!url.searchParams.has('acr_values'));assert(!('acr' in claims));}
    else{assert.equal(url.searchParams.get('acr_values'),policy.acr);assert.deepEqual(claims.acr,{essential:true,value:policy.acr});}
    const response=await fetch(url,{redirect:'manual'});const callback=new URL(response.headers.get('location'));
    try{const result=await personalCodeExchange(metadata,policy.clientId,'fresh-provider-secret',binding,callback,{displayName:'',email:''},policy,purpose,began,[origin]);assert.equal(result.proof.purpose,purpose);console.log('accepted');}catch{console.log('rejected');}
   }`;
  const run=async(acr)=> (await execute(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../../../',import.meta.url),env:{...process.env,TEST_PROVIDER:fixture.origin,TEST_ACR:JSON.stringify(acr),NODE_EXTRA_CA_CERTS:fixture.certificate},timeout:20000})).stdout.trim().split('\n');
  assert.deepEqual(await run(null),['accepted','accepted','accepted']);
  assert.deepEqual(await run('fixture:interactive-personal'),['rejected','rejected','rejected']);
  fixture.tokenOverrides={amr:['pwd']};
  assert.deepEqual(await run('fixture:interactive-personal'),['accepted','accepted','accepted']);
  fixture.tokenOverrides={acr:undefined,amr:['sso']};
  assert.deepEqual(await run(null),['rejected','rejected','rejected']);
  fixture.tokenOverrides={acr:undefined,amr:['pwd'],auth_time:1};
  assert.deepEqual(await run(null),['rejected','rejected','rejected']);
  fixture.tokenOverrides={acr:undefined,amr:['pwd']};fixture.invalidSignature=true;
  assert.deepEqual(await run(null),['rejected','rejected','rejected']);
 }finally{await fixture.close();}
});
test('real authorization/code/PKCE/signature exchange rejects malformed identities and handles overlapping signing keys',async()=>{
 const fixture=await discoveryProvider();
 try{
  const module=new URL('../dist/authentication/oidc-test-protocol.js',import.meta.url).href;
  const script=`import {testAuthorization,testCodeExchange} from ${JSON.stringify(module)};const origin=process.env.TEST_PROVIDER;const metadata={issuer:origin+'/adfs',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',id_token_signing_alg_values_supported:['RS256']};const binding={state:'state',nonce:'nonce',verifier:'verifier-with-enough-entropy-for-a-test',callback:'https://agency.example.org/api/sessions/oidc/callback',pkce:true};const url=await testAuthorization(metadata,'registered-client','fresh-provider-secret',['openid'],binding);const authorization=await fetch(url,{redirect:'manual'});const callback=new URL(authorization.headers.get('location'));try{console.log(JSON.stringify(await testCodeExchange(metadata,'registered-client','fresh-provider-secret',binding,callback,undefined,[origin])));}catch{console.log(JSON.stringify({failed:true}));}`;
  const run=async()=>JSON.parse((await execute(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../../../',import.meta.url),env:{...process.env,TEST_PROVIDER:fixture.origin,NODE_EXTRA_CA_CERTS:fixture.certificate},timeout:20000})).stdout);
  assert.deepEqual(await run(),{identityValidated:true,freshPersonalAuthentication:false,pkceS256:true});
  fixture.tokenKid='key-next';assert.equal((await run()).identityValidated,true);
  for(const mutation of [{iss:'https://wrong.example'},{aud:'wrong'},{azp:'wrong',aud:['registered-client','other']},{nonce:'wrong'},{exp:1},{nbf:Math.floor(Date.now()/1000)+600},{iat:Math.floor(Date.now()/1000)+600},{sub:''},{nonce:null},{exp:null},{iat:null}]){fixture.tokenOverrides=mutation;assert.equal((await run()).failed,true,JSON.stringify(mutation));}
  fixture.tokenOverrides={};fixture.headerOverrides={alg:'none'};assert.equal((await run()).failed,true);fixture.headerOverrides={alg:'HS256'};assert.equal((await run()).failed,true);fixture.headerOverrides={};fixture.invalidSignature=true;assert.equal((await run()).failed,true);fixture.invalidSignature=false;
  fixture.keys=Array.from({length:101},()=>fixture.keys[0]);assert.equal((await run()).failed,true);fixture.keys=[{...fixture.keys[0],d:'private-material'}];assert.equal((await run()).failed,true);
  fixture.keys=[];assert.equal((await run()).failed,true);fixture.keys=[{kty:'RSA',kid:'key-next',n:'broken',e:'broken'}];assert.equal((await run()).failed,true);
 }finally{await fixture.close();}
});
test('UserInfo supplies mapped profile hints bound to the signed subject without supplying authentication proof',async()=>{
 const fixture=await discoveryProvider();
 try{
  fixture.personalProofMode='fresh';fixture.userinfoOverrides={preferred_username:'alice'};
  const module=new URL('../dist/authentication/oidc-test-protocol.js',import.meta.url).href;
  const script=`import {testAuthorization,testCodeExchange,personalCodeExchange} from ${JSON.stringify(module)};
   const origin=process.env.TEST_PROVIDER,metadata={issuer:origin+'/adfs',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',userinfo_endpoint:origin+'/userinfo',id_token_signing_alg_values_supported:['RS256']};
   const policy={id:'fixture',groupId:'group',providerId:'provider',issuer:metadata.issuer,clientId:'registered-client',acr:null,requiredAmr:['fixture-personal']};
   const binding={state:'state',nonce:'nonce',verifier:'verifier-with-enough-entropy-for-a-test',callback:'https://agency.example.org/api/sessions/oidc/callback',pkce:true},mappings={displayName:'name',email:'email'};
   for(const personal of [false,true]){
    const began=new Date(Date.now()-2000),url=await testAuthorization(metadata,policy.clientId,'fresh-provider-secret',['openid','profile','email'],binding,personal?{policy,purpose:'login'}:undefined);
    const response=await fetch(url,{redirect:'manual'}),callback=new URL(response.headers.get('location'));
    try{const result=personal?await personalCodeExchange(metadata,policy.clientId,'fresh-provider-secret',binding,callback,mappings,policy,'login',began,[origin]):await testCodeExchange(metadata,policy.clientId,'fresh-provider-secret',binding,callback,mappings,[origin]);console.log(JSON.stringify(result.identity));}catch{console.log('rejected');}
   }`;
  const run=async()=> (await execute(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TEST_PROVIDER:fixture.origin,NODE_EXTRA_CA_CERTS:fixture.certificate},timeout:20000})).stdout.trim().split('\n').map(line=>line==='rejected'?line:JSON.parse(line));
  const identity={issuer:fixture.origin+'/adfs',subject:'fictional-provider-user',displayName:'Alice Smith',email:'alice@example.test',username:'alice'};
  assert.deepEqual(await run(),[identity,identity]);assert.equal(fixture.userinfoCount,2);
  fixture.userinfoOverrides={sub:'another-person'};assert.deepEqual(await run(),['rejected','rejected']);
  fixture.userinfoOverrides={preferred_username:'alice',iss:'https://wrong.example',amr:['fixture-personal'],auth_time:Math.floor(Date.now()/1000)};
  fixture.tokenOverrides={amr:['sso']};assert.deepEqual(await run(),[identity,'rejected']);
  fixture.tokenOverrides={name:'Signed Name',email:'signed@example.test',preferred_username:'signed.alice'};fixture.userinfoOverrides={sub:'another-person'};
  const signed={...identity,displayName:'Signed Name',email:'signed@example.test',username:'signed.alice'},before=fixture.userinfoCount;
  assert.deepEqual(await run(),[signed,signed]);assert.equal(fixture.userinfoCount,before);
  fixture.tokenOverrides={};fixture.invalidSignature=true;assert.deepEqual(await run(),['rejected','rejected']);assert.equal(fixture.userinfoCount,before);
 }finally{await fixture.close();}
});
