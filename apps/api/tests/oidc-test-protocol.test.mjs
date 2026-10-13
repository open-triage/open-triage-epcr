import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoveryProvider} from './fixtures/oidc-discovery-provider.mjs';
const execute=promisify(execFile);
test('real authorization/code/PKCE/signature exchange rejects malformed identities and handles overlapping signing keys',async()=>{
 const fixture=await discoveryProvider();
 try{
  const module=new URL('../dist/authentication/oidc-test-protocol.js',import.meta.url).href;
  const script=`import {testAuthorization,testCodeExchange} from ${JSON.stringify(module)};const origin=process.env.TEST_PROVIDER;const metadata={issuer:origin+'/adfs',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',id_token_signing_alg_values_supported:['RS256']};const binding={state:'state',nonce:'nonce',verifier:'verifier-with-enough-entropy-for-a-test',callback:'https://agency.example.org/api/sessions/oidc/callback',pkce:true};const url=await testAuthorization(metadata,'registered-client','fresh-provider-secret',['openid'],binding);const authorization=await fetch(url,{redirect:'manual'});const callback=new URL(authorization.headers.get('location'));try{console.log(JSON.stringify(await testCodeExchange(metadata,'registered-client','fresh-provider-secret',binding,callback)));}catch{console.log(JSON.stringify({failed:true}));}`;
  const run=async()=>JSON.parse((await execute(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../../../',import.meta.url),env:{...process.env,TEST_PROVIDER:fixture.origin,NODE_EXTRA_CA_CERTS:fixture.certificate,OIDC_PRIVATE_ORIGINS_JSON:JSON.stringify([fixture.origin])},timeout:20000})).stdout);
  assert.deepEqual(await run(),{identityValidated:true,freshPersonalAuthentication:false,pkceS256:true});
  fixture.tokenKid='key-next';assert.equal((await run()).identityValidated,true);
  for(const mutation of [{iss:'https://wrong.example'},{aud:'wrong'},{azp:'wrong',aud:['registered-client','other']},{nonce:'wrong'},{exp:1},{nbf:Math.floor(Date.now()/1000)+600},{iat:Math.floor(Date.now()/1000)+600},{sub:''},{nonce:null},{exp:null},{iat:null}]){fixture.tokenOverrides=mutation;assert.equal((await run()).failed,true,JSON.stringify(mutation));}
  fixture.tokenOverrides={};fixture.headerOverrides={alg:'none'};assert.equal((await run()).failed,true);fixture.headerOverrides={alg:'HS256'};assert.equal((await run()).failed,true);fixture.headerOverrides={};fixture.invalidSignature=true;assert.equal((await run()).failed,true);fixture.invalidSignature=false;
  fixture.keys=Array.from({length:101},()=>fixture.keys[0]);assert.equal((await run()).failed,true);fixture.keys=[{...fixture.keys[0],d:'private-material'}];assert.equal((await run()).failed,true);
  fixture.keys=[];assert.equal((await run()).failed,true);fixture.keys=[{kty:'RSA',kid:'key-next',n:'broken',e:'broken'}];assert.equal((await run()).failed,true);
 }finally{await fixture.close();}
});
