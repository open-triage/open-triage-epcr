import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { resolveHospitalIdentifier, type EpsContext, type EpsLookup } from '@open-triage/contracts';
import { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { clinicalFormConfiguration } from '../forms/clinical-form-configuration.js';
import { encounterDocument } from '../reports/encounter-document.persistence.js';
import { recordPatientAccess } from '../reports/patient-access-audit.js';
import {buildEpsOutput} from './eps-output.js';
import type {SignedGroup,SignedOccurrence} from '../reports/signed-report-pdf.js';
import { mappingPackage } from './hospital-mapping.js';
import { EpsAdapter } from './eps-adapter.js';
@Injectable()
export class EpsService {
  readonly adapter = new EpsAdapter();
  constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
  private async snapshot(token:string,reportId:string,audit=false,expectedBinding?:string,preview=false) {
    return this.database.transaction('REPEATABLE READ',async manager=>{
      const actor=await this.sessions.requireCapability(token,'clinical:document',manager);
      const [report]=await manager.query<Array<{patient_id:string;form_version_id:string;catalog_release_id:string;revision:string}>>(`select patient_id,form_version_id,catalog_release_id,revision from clinical.report where id=$1 and organization_id=$2 and documenting_user_id=$3 and status='draft' and (expires_at is null or expires_at>clock_timestamp())`,[reportId,actor.organization.id,actor.user.id]);
      if(!report)throw new NotFoundException();
      const [active]=await manager.query<Array<{revision:string;canonical_mapping:unknown}>>(`select v.revision,v.canonical_mapping from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=app_identity.organization_group($1)`,[actor.organization.id]);
      if(!active)return {context:null,identifier:null};
      const mapping=mappingPackage(active.canonical_mapping);
      const document=await encounterDocument(manager,reportId);
      const form=await clinicalFormConfiguration(manager,report.form_version_id,report.catalog_release_id);
      const resolved=resolveHospitalIdentifier(mapping.definition.patientIdentifier,document,form);
      const binding=createHash('sha256').update(JSON.stringify([reportId,actor.organization.id,actor.user.id,report.patient_id,resolved,active.revision,mapping.sha256])).digest('hex');
      const context:EpsContext={reportId,organizationId:actor.organization.id,binding,configurationRevision:Number(active.revision),mappingId:mapping.definition.id,mappingRevision:mapping.definition.revision,mappingSha256:mapping.sha256,patientIdentifier:mapping.definition.patientIdentifier};
      if(expectedBinding&&context.binding!==expectedBinding)throw new ConflictException({code:'eps.stale'});
      // A draft preview is a read: no persisted export resource exists for an eps.export event.
      if(audit)await recordPatientAccess(manager,{organizationId:actor.organization.id,actorId:actor.user.id,reportIds:[reportId],action:'eps.read',careProcess:'documentation',integrationProvenance:{configurationRevision:context.configurationRevision,mappingId:context.mappingId,mappingRevision:context.mappingRevision,mappingSha256:context.mappingSha256}});
      let outgoing;
      if(preview){
        const groupRows=await manager.query<Array<{value:SignedGroup}>>("select to_jsonb(g) as value from clinical.group_instance g where report_id=$1 and tombstoned_at is null order by group_id,ordinal,id",[reportId]);
        const groups=groupRows.map(row=>row.value);
        // Match signed-manifest JSON scalar representations (dates and base64 binary included).
        const occurrenceRows=await manager.query<Array<{value:SignedOccurrence}>>("select to_jsonb(o) || jsonb_build_object('value_binary',encode(value_binary,'base64')) as value from clinical.element_occurrence o where report_id=$1 and tombstoned_at is null order by element_id,ordinal,id",[reportId]);
        const occurrences=occurrenceRows.map(row=>row.value);
        // Ephemeral projection only: no signature, prepared submission, or publication is created.
        const output=buildEpsOutput({signedAt:new Date().toISOString(),groups,occurrences,amendments:[],amendmentSequence:0,configuration:form},active.canonical_mapping,reportId);
        outgoing={revision:Number(report.revision),configurationRevision:context.configurationRevision,findings:output.findings,
          patientIdentifier:resolved.identifier,bundle:output.bundle};
      }
      return {context,identifier:resolved.identifier,outgoing};
    });
  }
  async outgoing(token:string,reportId:string,binding:string){
    if(!binding)throw new ConflictException({code:'eps.stale'});
    const result=await this.snapshot(token,reportId,true,binding,true);
    if(!result.context)throw new ConflictException({code:'epsSubmission.disabled'});
    return result.outgoing;
  }
  async context(token:string,reportId:string) {return (await this.snapshot(token,reportId)).context;}
  async lookup(token:string,reportId:string,binding:string):Promise<EpsLookup> {
    const before=await this.snapshot(token,reportId);
    if(!before.context)return {context:null,status:'disabled'};
    if(binding!==before.context.binding)throw new ConflictException({code:'eps.stale'});
    if(!before.identifier)return {context:before.context,status:'missing'};
    let result:Awaited<ReturnType<EpsAdapter['discover']>>;
    try {result=await this.adapter.discover(before.context.patientIdentifier,before.identifier);}catch{throw new ServiceUnavailableException({code:'eps.failed'});}
    const after=await this.snapshot(token,reportId,true,before.context.binding);
    if(after.context?.binding!==before.context.binding)throw new ConflictException({code:'eps.stale'});
    return {context:after.context,status:result?'available':'no-match',...(result??{}),retrievedAt:new Date().toISOString()};
  }
}
