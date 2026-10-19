import test from 'node:test';
import assert from 'node:assert/strict';
import {hospitalIdentifierSchemeFinding,SWEDISH_PATIENT_IDENTIFIER_NAMESPACES as schemes} from '@open-triage/contracts';
const checked=prefix=>{let sum=0;for(let index=2;index<11;index++){const p=Number(prefix[index])*(index%2===0?2:1);sum+=p>9?p-9:p;}return prefix+((10-sum%10)%10);};
test('documented Swedish schemes validate exact value, date and checksum without coercion or namespace aliases',()=>{
 for(const [scheme,prefix] of [[schemes.personal,'20020725238'],[schemes.coordination,'20020785238'],[schemes.carelinkReserve,'19810832001']]){
  const value=checked(prefix);assert.equal(hospitalIdentifierSchemeFinding(scheme,value),null);
  assert.equal(hospitalIdentifierSchemeFinding(scheme,value.slice(0,-1)+(Number(value.at(-1))+1)%10),'invalid');
  assert.equal(hospitalIdentifierSchemeFinding(scheme,' '+value),'invalid');
 }
 assert.equal(hospitalIdentifierSchemeFinding(schemes.personal,checked('20020231238')),'invalid');
 assert.equal(hospitalIdentifierSchemeFinding(schemes.personal,checked('20030229238')),'invalid');
 assert.equal(hospitalIdentifierSchemeFinding(schemes.personal,checked('20000229238')),null);
 assert.equal(hospitalIdentifierSchemeFinding(schemes.personal,checked('20020785238')),'invalid');
 assert.equal(hospitalIdentifierSchemeFinding(schemes.coordination,checked('20020725238')),'invalid');
 assert.equal(hospitalIdentifierSchemeFinding(schemes.carelinkReserve,checked('19810831001')),'invalid');
 assert.equal(hospitalIdentifierSchemeFinding('urn:unsupported:reserve','198108320014'),'unsupported');
});
