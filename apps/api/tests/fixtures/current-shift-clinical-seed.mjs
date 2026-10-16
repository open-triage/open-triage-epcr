import {randomUUID} from 'node:crypto';
import {ValidationAuthoringService} from '../../dist/admin/validation-authoring.service.js';
import {canonicalDefinitionSha256} from '../../dist/forms/form-publication.validation.js';
/** Minimal immutable published configuration for real standalone creation. */
export async function seedShiftConfiguration(db,agency,actor,{catalogReleaseId}={}){
 let identity;
 const catalog=catalogReleaseId??randomUUID(),form=randomUUID(),version=randomUUID(),demographics=randomUUID(),hash='a'.repeat(64);
 const definition={schemaVersion:1,sections:[]},formHash=canonicalDefinitionSha256(definition);
 if(!catalogReleaseId){
 await db.query("insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance,sealed) values($1,'Fictional','017',$3,'1',$2,'{}',false)",[catalog,hash,agency]);
 const groups=['EMSDataSet','HeaderGroup','PatientCareReportGroup','eRecordSection'];
 for(const [index,group] of groups.entries())await db.query(`insert into catalog.group_definition(release_id,group_id,parent_group_id,name,path,min_occurs,max_occurs,unbounded,repeating,definition)
 values($1,$2,$3,$2,$4,0,1,false,false,'{}')`,[catalog,group,index?groups[index-1]:null,groups.slice(0,index+1)]);
 identity=(await db.query("select id from catalog.element_identity where namespace='NEMSIS' and canonical_key='eRecord.01'"))[0]?.id??randomUUID();
 await db.query("insert into catalog.element_identity(id,namespace,canonical_key) values($1,'NEMSIS','eRecord.01') on conflict(namespace,canonical_key) do nothing",[identity]);
 await db.query(`insert into catalog.element_definition(release_id,element_id,element_identity_id,section,name,description,national,state,usage,source_datatype,base_datatype,group_path,min_occurs,max_occurs,unbounded,nillable,supports_not_values,supports_pertinent_negatives,definition)
 values($1,'eRecord.01',$2,'eRecord','PCR number','Fictional PCR number',false,false,'Optional','string','string',$3,0,1,false,false,false,false,'{}')`,[catalog,identity,groups]);
 await db.query("insert into catalog.analytics_element_mapping(release_id,element_id,element_identity_id,analytical_location,sql_column,sql_type,identifying,mapping) values($1,'eRecord.01',$2,'repeatable',null,'text',false,'{}')",[catalog,identity]);
 await db.query('update catalog.release set sealed=true where id=$1',[catalog]);
 }
 await db.query("insert into forms.form(id,organization_id,slug,name) values($1,$2,'shift-fixture','Fictional shift fixture')",[form,agency]);
 await db.query("insert into forms.form_version(id,form_id,catalog_release_id,version,status,canonical_definition,definition_sha256,created_by,published_by,published_at,change_note) values($1,$2,$3,1,'published',$4::jsonb,$5,$6,$6,now(),'Controlled shift regression')",[version,form,catalog,JSON.stringify(definition),formHash,actor]);
 await db.query("insert into app_identity.agency_demographic_version(id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by) values($1,$2,$3,1,'fictional','fixture','fixture',$4,now(),$5)",[demographics,agency,catalog,hash,actor]);
 const service=new ValidationAuthoringService(db,{requireCapability:async()=>({organization:{id:agency},user:{id:actor}})});
 const policy=await service.create('fixture',{catalogReleaseId:catalog,displayName:'Fictional shift policy'},
  {importedRules:[{id:randomUUID(),name:'Fictional PCR',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'eRecord.01',message:'Fictional PCR',source:'require present("eRecord.01")'}]});
 const published=await service.publish('fixture',policy.id,{expectedRevision:policy.revision,displayName:policy.displayName,changeNote:'Controlled shift regression'});
 await service.activate('fixture',published.id,{formVersionId:version,catalogReleaseId:catalog,changeNote:'Controlled shift regression'});
}
