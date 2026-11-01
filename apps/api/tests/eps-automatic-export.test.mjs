import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {queueSignedEps} from '../dist/hospital/eps-automatic-export.js';

const require=createRequire(import.meta.url);
for(const tuple of [false,true])test(`automatic EPS export audits the prepared row with ${tuple?'driver tuple':'plain rows'}`,async t=>{
 t.mock.method(require('../dist/reports/signed-report-pdf.persistence.js'),'signedReportSource',async()=>({synthetic:true,canonicalSha256:'source'}));
 t.mock.method(require('../dist/hospital/hospital-mapping.js'),'mappingPackage',()=>({definition:{id:'mapping',revision:1},sha256:'mapping-hash'}));
 t.mock.method(require('../dist/hospital/eps-output.js'),'buildEpsOutput',()=>({findings:[],bundle:{resourceType:'Bundle'},amendmentHashes:[]}));
 t.mock.method(require('../dist/hospital/eps-validation.js'),'receiverEpsValidation',async()=>({state:'pending'}));
 const audits=[];
 t.mock.method(require('../dist/reports/patient-access-audit.js'),'recordPatientAccess',async(_manager,event)=>audits.push(event));
 let preparedId;
 const manager={query:async(sql,parameters)=>{
  if(sql.startsWith('select pg_advisory'))return [];
  if(sql.startsWith('select s.id,r.state'))return [];
  if(sql.startsWith('select v.revision'))return [{revision:'2',group_id:'group',canonical_mapping:{}}];
  if(sql.startsWith('insert into clinical.eps_submission')){
   preparedId=parameters[0];
   const rows=[{id:preparedId,report_id:'report',organization_id:'agency',prepared_by:'author',configuration_revision:'2',mapping_id:'mapping',mapping_revision:1,mapping_sha256:'mapping-hash'}];
   return tuple?[rows,1]:rows;
  }
  throw Error(`Unexpected query: ${sql}`);
 }};
 await queueSignedEps(manager,'report','snapshot','author');
 assert.equal(audits.length,1);
 assert.deepEqual(audits[0],{organizationId:'agency',actorId:'author',reportIds:['report'],action:'eps.export',resourceId:preparedId,careProcess:'documentation',integrationProvenance:{configurationRevision:2,mappingId:'mapping',mappingRevision:1,mappingSha256:'mapping-hash',decision:'automatic-signing-export'}});
});
