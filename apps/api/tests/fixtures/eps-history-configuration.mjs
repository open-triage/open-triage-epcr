import {randomUUID} from 'node:crypto';
import {CatalogAuthoringService} from '../../dist/admin/catalog-authoring.service.js';
import {FormPublicationService} from '../../dist/forms/form-publication.service.js';
import {canonicalDefinitionSha256} from '../../dist/forms/form-publication.validation.js';
import {ValidationAuthoringService} from '../../dist/admin/validation-authoring.service.js';
/** Ordinary publication pins the custom field to a new catalog and form. */
export async function epsHistoryConfiguration({database,query,sessions,token,organizationId,authorId,definition}) {
 const catalogs=new CatalogAuthoringService(database,sessions),historyFieldId=randomUUID();
 let draft=await catalogs.cloneActive(token,{displayName:'EPS history fixture'});
 draft=await catalogs.save(token,draft.id,{expectedRevision:draft.revision,displayName:'EPS history fixture',definition:{...draft.definition,customElements:[...(draft.definition.customElements??[]),{id:historyFieldId,namespace:'org.opentriage.epsfixture',slug:`history-${historyFieldId}`,title:'Imported clinical history',definition:'Selected historical facts with their original source context.',datatype:'string',recurrence:'multiple',usage:'Optional',constraints:{maxLength:20000},identifying:true}]}});
 const catalog=await catalogs.publish(token,draft.id,{expectedRevision:draft.revision,definitionSha256:draft.definitionSha256,displayName:'EPS history fixture',changeNote:'Pinned EPS history test field'});
 const formId=randomUUID(),versionId=randomUUID(),formDefinition=structuredClone(definition);
 formDefinition.sections[0].fields.push({key:'clinical-history',source:{kind:'custom',elementDefinitionId:historyFieldId}});
 const digest=canonicalDefinitionSha256(formDefinition);
 await query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'EPS history fixture')",[formId,organizationId,`eps-history-${formId}`]);
 await query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[versionId,formId,catalog.id,JSON.stringify(formDefinition),digest,authorId]);
 await new FormPublicationService(database).publish(versionId,{publishedBy:authorId,definitionSha256:digest,changeNote:'EPS history fixture'},organizationId);
 const validations=new ValidationAuthoringService(database,sessions);
 const policy=await validations.create(token,{catalogReleaseId:catalog.id,displayName:'EPS history fixture policy'},{importedRules:[{id:randomUUID(),name:'Fictional identifier',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'ePatient.01',message:'Fictional identifier required',source:'require present("ePatient.01")'}]});
 const published=await validations.publish(token,policy.id,{expectedRevision:policy.revision,displayName:policy.displayName,changeNote:'EPS history fixture'});
 for(let i=0;i<2;i++)await validations.activate(token,published.id,{formVersionId:versionId,catalogReleaseId:catalog.id,changeNote:'EPS history fixture activation'});
 return {historyFieldId};
}
