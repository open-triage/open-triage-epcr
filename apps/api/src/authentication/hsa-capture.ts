import type { EntityManager } from 'typeorm';
export type HsaCandidate={value:string|null;finding:'missing'|'malformed'|null;authoritative:boolean};
export function hsaCandidate(claims:Record<string,unknown>,claim:string|undefined,authoritative=false):HsaCandidate|undefined {
 if(!claim)return undefined;
 const raw=Object.hasOwn(claims,claim)?claims[claim]:undefined;
 if(raw===undefined||raw===null)return {value:null,finding:'missing',authoritative};
 if(typeof raw!=='string'||!raw.trim()||raw.length>128||/[\p{Cc}\p{Cf}]/u.test(raw))return {value:null,finding:'malformed',authoritative};
 return {value:raw.trim(),finding:null,authoritative};
}
/** Only the active, validated personal login calls this; draft tests cannot assign identifiers. */
export async function captureHsa(manager:EntityManager,userId:string,organizationId:string,candidate:HsaCandidate|undefined,
 provenance:{issuer:string;subject:string;providerRevision:number;providerId:string},actorId=userId){
 if(!candidate)return;
 const [user]=await manager.query<Array<{hsa_id:string|null;revision:number}>>('select hsa_id,revision from app_identity.app_user where id=$1 for update',[userId]);
 if(!user)return;
 let finding:string|null=candidate.finding;
 if(candidate.value&&candidate.authoritative){
  await manager.query(`select pg_advisory_xact_lock(hashtextextended(app_identity.organization_group($1)::text || ':' || $2,76211))`,[organizationId,candidate.value]);
  const duplicate=await manager.query(`select id from app_identity.app_user where id<>$1 and hsa_id=$2 and app_identity.organization_group(organization_id)=app_identity.organization_group($3)`,[userId,candidate.value,organizationId]);
  if(duplicate.length||user.hsa_id&&user.hsa_id!==candidate.value){
   finding='conflict';await manager.query('update app_identity.app_user set hsa_conflict=true,revision=revision+1 where id=$1 and not hsa_conflict',[userId]);
  }else if(!user.hsa_id){
   await manager.query(`update app_identity.app_user set hsa_id=$2,hsa_source='oidc',revision=revision+1 where id=$1`,[userId,candidate.value]);
  }
 }
 await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,target_user_id,action,result,details)
 values($1,$2,$3,'account.identity_change','succeeded',$4::jsonb)`,[organizationId,actorId,userId,JSON.stringify({operation:"hsa_capture",candidate,...provenance,capturedAt:new Date().toISOString(),finding,previousHsaId:user.hsa_id,previousRevision:user.revision})]);
}
