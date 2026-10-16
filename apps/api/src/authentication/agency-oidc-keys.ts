import {randomBytes} from 'node:crypto';
import type {EntityManager} from 'typeorm';
import {encryptCredential,decryptCredential,encryptWithKey,decryptWithKey,type CredentialEnvelope} from './oidc-credentials.js';
type Database=Pick<EntityManager,'query'>;
type KeyRow={version:number;encrypted_key:CredentialEnvelope};
function unwrap(row:KeyRow,groupId:string):Buffer {
 const bytes=Buffer.from(decryptCredential(row.encrypted_key,groupId,`agency-key:${row.version}`),'base64');
 if(bytes.length!==32)throw new Error('OIDC credential encryption is unavailable');
 return bytes;
}
/** Call inside the personal-authority/policy transaction. Never retire retained keys. */
export async function generateAgencyKey(manager:Database,groupId:string,actorId:string,rotate=false,expectedVersion?:number) {
 await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[groupId]);
 const [prior]=await manager.query<KeyRow[]>('select version,encrypted_key from app_identity.oidc_credential_key where group_id=$1 order by version desc limit 1',[groupId]);
 if(expectedVersion!==undefined&&Number(prior?.version??0)!==expectedVersion)throw new Error('OIDC key version changed');
 if(prior&&!rotate)return Number(prior.version);
 const version=Number(prior?.version??0)+1;
 const envelope=encryptCredential(randomBytes(32).toString('base64'),groupId,`agency-key:${version}`);
 await manager.query('insert into app_identity.oidc_credential_key(group_id,version,encrypted_key,created_by) values($1,$2,$3::jsonb,$4)',[groupId,version,JSON.stringify(envelope),actorId]);
 return version;
}
export async function encryptAgencyCredential(manager:Database,secret:string,groupId:string,providerId:string):Promise<CredentialEnvelope> {
 const [row]=await manager.query<KeyRow[]>('select version,encrypted_key from app_identity.oidc_credential_key where group_id=$1 order by version desc limit 1',[groupId]);
 if(!row)return encryptCredential(secret,groupId,providerId); // Retained installation-managed integrations.
 return {...encryptWithKey(secret,groupId,providerId,String(row.version),unwrap(row,groupId)),keyScope:'agency'};
}
export async function decryptAgencyCredential(manager:Database,envelope:CredentialEnvelope,groupId:string,providerId:string):Promise<string> {
 if(!envelope.keyScope)return decryptCredential(envelope,groupId,providerId);
 if(envelope.keyScope!=='agency')throw new Error('OIDC credential encryption is unavailable');
 const [row]=await manager.query<KeyRow[]>('select version,encrypted_key from app_identity.oidc_credential_key where group_id=$1 and version=$2',[groupId,envelope.version]);
 if(!row)throw new Error('OIDC credential encryption is unavailable');
 return decryptWithKey(envelope,groupId,providerId,unwrap(row,groupId));
}
