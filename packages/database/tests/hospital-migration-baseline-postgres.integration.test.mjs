import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { applyMigrations, readMigrations } from "../scripts/migrate.mjs";
import history from "./fixtures/hospital-legacy-migrations.json" with { type: "json" };

if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const integration = process.env.DATABASE_URL ? test : test.skip;
const snapshot=async db=>{
 const schema="n.nspname in ('app_identity','clinical','clinical_audit','public','analytics','offline_recovery')";
 const {rows}=await db.query(`select n.nspname||'.'||c.relname as name, c.relkind, c.relrowsecurity,
 case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end as definition,
 (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
 (select jsonb_agg(pg_get_constraintdef(co.oid) order by co.conname) from pg_constraint co where co.conrelid=c.oid) as constraints,
 (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid) as indexes
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${schema} and c.relkind in ('r','v','m','p') order by 1`);
 const functions=(await db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${schema} and p.prokind='f' order by 1,2,3`)).rows;
 const policies=(await db.query(`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('app_identity','clinical','clinical_audit','public','analytics','offline_recovery') order by 1,2,3`)).rows;
 const triggers=(await db.query(`select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${schema} and not t.tgisinternal order by 1,2,3`)).rows;
 const grants=(await db.query(`select n.nspname,c.relname,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${schema} and c.relkind in ('r','v','m','p','S') order by 1,2`)).rows;
 return {tables:rows,functions,policies,triggers,grants};
};
integration("original hospital migrations converge with fresh baseline including security and all subsequent migrations", async t => {
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 t.after(()=>admin.end());
 const migrations=await readMigrations(fileURLToPath(new URL("../../../supabase/migrations",import.meta.url)));
 const states=[];
 for(const kind of ["baseline","historical"]){
  const name=`hospital_baseline_${randomUUID().replaceAll("-","")}`;
  const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
  await admin.query(`create database ${name}`);
  const db=new pg.Client({connectionString:url.toString()});
  try{
   await db.connect();
   await applyMigrations(db,migrations.filter(row=>row.version<history[0].version),{info(){}});
   if(kind==="historical"){
    await applyMigrations(db,history.map(({version,name,checksum,statements})=>({version,name,checksum,sql:statements.join("\n")})),{info(){}});
   }
   const before=(await db.query("select version,checksum from open_triage_deploy.migration_checksums order by version")).rows;
   await applyMigrations(db,migrations,{info(){}});
   assert.equal(await applyMigrations(db,migrations,{info(){}}),0);
   if(kind==="historical"){
    const original=(await db.query("select version,checksum from open_triage_deploy.migration_checksums where version=any($1::text[]) order by version",[before.map(row=>row.version)])).rows;
    assert.deepEqual(original,before,"original history checksums must remain intact");
   }
   states.push(await snapshot(db));
  }finally{await db.end();await admin.query(`drop database ${name} with (force)`);}
 }
 assert.deepEqual(states[1],states[0],"historical and fresh databases must expose identical schema, functions, policies, triggers and grants");
});
