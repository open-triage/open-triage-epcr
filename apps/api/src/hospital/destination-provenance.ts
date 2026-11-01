import {UnprocessableEntityException} from '@nestjs/common';
import {isDestinationSelection} from '@open-triage/contracts';
import type {EntityManager} from 'typeorm';
import type {DraftValue} from '../reports/draft-report.types.js';
/** Shared by draft saves and amendments; clients can select an entry, never supply an HSA mapping. */
export async function validateDestinationProvenance(manager:Pick<EntityManager,'query'>,organizationId:string,elementId:string,value:DraftValue|undefined,selection:unknown){
 if(selection===undefined||selection===null)return null;
 if(!['eDisposition.01','eDisposition.02'].includes(elementId)||!isDestinationSelection(selection))throw new UnprocessableEntityException({code:'hospital.destinationInvalid'});
 const [entry]=await manager.query<Array<{display_name:string;local_code:string}>>(`select display_name,local_code from app_identity.destination_revision where group_id=app_identity.organization_group($1) and destination_id=$2 and revision=$3`,[organizationId,selection.directoryId,selection.revision]);
 if(!entry||entry.display_name!==selection.displayName||entry.local_code!==selection.localCode||value?.kind!=='text'||value.value!==(elementId==='eDisposition.01'?entry.display_name:entry.local_code))throw new UnprocessableEntityException({code:'hospital.destinationInvalid'});
 return selection;
}
