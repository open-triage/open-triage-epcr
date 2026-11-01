import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ensureCosPatient} from '../dist/hospital/cos-live-delivery.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('patient creation claim is committed, shared across reports and survives worker restart',async()=>{
 const name='cos_patient_'+randomUUID().replaceAll('-','');const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();const clients=[];
 try{
  await admin.query(`create database ${name}`);
  const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
  for(let i=0;i<2;i++){const c=new pg.Client({connectionString:url.href});await c.connect();clients.push(c);}
  const [a,b]=clients;
  // Isolate the ledger contract so this concurrency test needs no clinical seed,
  // credentials, patient records or remote COS access. Apply the actual migration.
  await a.query(`create schema clinical;
   create table clinical.report(id uuid primary key,expires_at timestamptz);
   create table clinical.cos_artifact(delivery_id uuid,artifact_key text,report_id uuid references clinical.report(id),kind text constraint cos_artifact_kind_check check(kind in ('patient','encounter','observation','note','pdf','context')),primary key(delivery_id,artifact_key));
   create table clinical.cos_artifact_event(id bigint generated always as identity primary key,delivery_id uuid,artifact_key text,report_id uuid,state text,remote_id text,evidence jsonb,foreign key(delivery_id,artifact_key) references clinical.cos_artifact(delivery_id,artifact_key));`);
  const migration=await readFile(new URL('../../../supabase/migrations/20261019104900_hospital_integration.sql',import.meta.url),'utf8');
  const claimIndex=migration.match(/create unique index cos_patient_registration_once[^]*?;/);assert.ok(claimIndex);
  await a.query(claimIndex[0]);
  const ids=[randomUUID(),randomUUID()],reports=[randomUUID(),randomUUID()];
  for(let i=0;i<2;i++){await a.query('insert into clinical.report(id) values($1)',[reports[i]]);await a.query("insert into clinical.cos_artifact values($1,'patient',$2,'patient')",[ids[i],reports[i]]);}
  const patient={artifact_key:'patient',kind:'patient',state:'prepared',resource:{resourceType:'Patient',identifier:[{system:'urn:oid:1.2.752.129.2.1.3.3',value:'201304822172'}],name:[{family:'Test',given:['Synthetic']}],gender:'male',birthDate:'2013-04-22'}};
  let writes=0;const adapter={settings:{baseUrl:'https://example.invalid/api/',tokenUrl:'https://example.invalid/token',clientId:'test'},authenticate:async()=>{},findPatient:async()=>undefined,write:async()=>{
   writes++;assert.equal((await b.query("select count(*)::int n from clinical.cos_artifact_event where state='sending'")).rows[0].n,1,'other connection sees committed intent before POST');
   throw Error('receipt lost after remote commit');
  }};
  const db=c=>({query:async(s,p)=>(await c.query(s,p)).rows});
  await Promise.all([ensureCosPatient(db(a),ids[0],patient,adapter,true),ensureCosPatient(db(b),ids[1],patient,adapter,true)]);
  assert.equal(writes,1);
  await ensureCosPatient(db(a),ids[0],patient,adapter,true);assert.equal(writes,1,'restart cannot replay');
  adapter.findPatient=async()=>({...patient.resource,id:'6905'});
  assert.equal(await ensureCosPatient(db(b),ids[1],patient,adapter,false),true,'read-only recovery clears uncertainty');
  assert.equal(writes,1);
 }finally{for(const c of clients)await c.end();await admin.query(`drop database if exists ${name}`);await admin.end();}
});
