import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
const moduleUrl=new URL('../dist/authentication/oidc-library.js',import.meta.url).href;
test('OIDC protocol setup loads async ESM without requiring CommonJS ESM interop',()=>{
  const script=`import {oidcConfiguration} from ${JSON.stringify(moduleUrl)};const configuration=await oidcConfiguration({issuer:'https://idp.example.org',authorization_endpoint:'https://idp.example.org/authorize',token_endpoint:'https://idp.example.org/token',jwks_uri:'https://idp.example.org/jwks'},'registered-client','test-client-secret');console.log(configuration.serverMetadata().issuer);`;
  const result=execFileSync(process.execPath,['--no-experimental-require-module','--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(result.trim(),'https://idp.example.org');
});
