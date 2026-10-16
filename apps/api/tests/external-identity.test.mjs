import assert from 'node:assert/strict';
import test from 'node:test';
import { externalIdentity } from '../dist/authentication/external-identity.service.js';
test('external identity keys preserve exact case and profile mapping never supplies identity or authorization',()=>{
 const claims={iss:'https://provider.example/Issuer',sub:'CaseSensitiveSubject',name:'<img src=x onerror=alert(1)>',email:'same@example.org',roles:['administrator']};
 assert.deepEqual(externalIdentity(claims,{displayName:'name',email:'email'}),{issuer:claims.iss,subject:claims.sub,displayName:claims.name,email:claims.email,username:null});
 assert.notEqual(externalIdentity({...claims,sub:'casesensitivesubject'},{displayName:'name',email:'email'}).subject,claims.sub);
 assert.deepEqual(externalIdentity({...claims,name:'x'.repeat(257),email:{value:'same@example.org'}},{displayName:'name',email:'email'}),{issuer:claims.iss,subject:claims.sub,displayName:null,email:null,username:null});
 assert.equal(externalIdentity({...claims,name:'unsafe\ntext'},{displayName:'name',email:'email'}).displayName,null);
 for(const sub of ['',null,{},'x'.repeat(256),'two\nlines'])assert.throws(()=>externalIdentity({...claims,sub},{displayName:'name',email:'email'}));
});

test('provider usernames are optional bounded profile hints, independently mapped from immutable identity keys',()=>{
 const claims={iss:'https://provider.example',sub:'immutable-subject',preferred_username:'Alice.Name',upn:'alice@example.org'};
 const mappings={displayName:'name',email:'email'};
 assert.equal(externalIdentity(claims,mappings).username,'Alice.Name');
 assert.equal(externalIdentity(claims,{...mappings,username:'upn'}).username,'alice@example.org');
 assert.equal(externalIdentity(claims,{...mappings,username:''}).username,null);
 for(const value of [undefined,null,'',{},['alice'],'x'.repeat(257),'alice\nadmin'])assert.equal(externalIdentity({...claims,preferred_username:value},mappings).username,null);
 assert.equal(externalIdentity({...claims,preferred_username:'another'},mappings).subject,claims.sub);
});
