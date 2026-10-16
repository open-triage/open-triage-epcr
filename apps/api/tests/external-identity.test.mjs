import assert from 'node:assert/strict';
import test from 'node:test';
import { externalIdentity } from '../dist/authentication/external-identity.service.js';
test('external identity keys preserve exact case and profile mapping never supplies identity or authorization',()=>{
 const claims={iss:'https://provider.example/Issuer',sub:'CaseSensitiveSubject',name:'<img src=x onerror=alert(1)>',email:'same@example.org',roles:['administrator']};
 assert.deepEqual(externalIdentity(claims,{displayName:'name',email:'email'}),{issuer:claims.iss,subject:claims.sub,displayName:claims.name,email:claims.email});
 assert.notEqual(externalIdentity({...claims,sub:'casesensitivesubject'},{displayName:'name',email:'email'}).subject,claims.sub);
 assert.deepEqual(externalIdentity({...claims,name:'x'.repeat(257),email:{value:'same@example.org'}},{displayName:'name',email:'email'}),{issuer:claims.iss,subject:claims.sub,displayName:null,email:null});
 assert.equal(externalIdentity({...claims,name:'unsafe\ntext'},{displayName:'name',email:'email'}).displayName,null);
 for(const sub of ['',null,{},'x'.repeat(256),'two\nlines'])assert.throws(()=>externalIdentity({...claims,sub},{displayName:'name',email:'email'}));
});
