import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { AgencyDirectoryService } from "../sessions/agency-directory.service.js";
import { agencyRequest } from "../sessions/agency-context.js";
import { mutationRows } from "../database/mutation-result.js";
import { enrollmentAttemptBinding, enrollmentAttemptCredential, enrollmentDigest, sameEnrollmentDigest } from "./enrollment-attempt.js";
import { revokeRegistrationSessions } from "../sessions/installation-session.js";
import { DEFAULT_PAIRING_EXPIRY_MINUTES, MAX_PAIRING_EXPIRY_MINUTES } from "@open-triage/contracts";
import { pairingCaPem } from "./pairing-trust.js";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const columns = `i.id,i.installation_identity_id as "installationId",i.organization_id as "organizationId",i.unit_id as "unitId",i.name,i.enrolled_at as "enrolledAt",i.revoked_at as "revokedAt"`;
export type InstallationSummary = { id: string; installationId: string; organizationId: string; unitId: string; name: string; enrolledAt: string; revokedAt: string | null };
export function enrollmentExpiryMinutes(input: unknown): number {
 if (input === undefined) return DEFAULT_PAIRING_EXPIRY_MINUTES;
 if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnprocessableEntityException("Invalid pairing expiry");
 const body = input as Record<string, unknown>;
 const minutes = "expiresInMinutes" in body ? body.expiresInMinutes : DEFAULT_PAIRING_EXPIRY_MINUTES;
 if (Object.keys(body).some(key => key !== "expiresInMinutes" && key !== "name") ||
     typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PAIRING_EXPIRY_MINUTES) {
 throw new UnprocessableEntityException(`Pairing expiry must be between 1 and ${MAX_PAIRING_EXPIRY_MINUTES} whole minutes`);
 }
 return minutes;
}
export function enrollmentName(input: unknown): string | undefined {
 if (input === undefined || !(input && typeof input === "object") || !("name" in input)) return undefined;
 const name = (input as Record<string, unknown>).name;
 if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
 throw new UnprocessableEntityException("A valid installation name is required");
 }
 return name.trim();
}
export function enrollmentInput(input: unknown, consuming: boolean): { token: string; name?: string; reassign?: boolean; attempt?: string } {
 if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnprocessableEntityException("Invalid enrollment");
 const b = input as Record<string, unknown>;
 if (Object.keys(b).some(key => !(consuming ? ["token","name","confirmInstallation","reassign","attempt"] : ["token"]).includes(key)) ||
 typeof b.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.token)) throw new UnprocessableEntityException("Invalid enrollment code");
 if ("attempt" in b && (!consuming || typeof b.attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.attempt) || Buffer.from(b.attempt,"base64url").toString("base64url") !== b.attempt)) throw new UnprocessableEntityException("Invalid enrollment attempt");
 if ("reassign" in b && (!consuming || b.reassign !== true)) throw new UnprocessableEntityException("Invalid reassignment confirmation");
 if (consuming && (b.confirmInstallation !== true || typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 || /[\u0000-\u001f\u007f]/u.test(b.name))) {
 throw new UnprocessableEntityException("Name and explicit intended installation confirmation are required");
 }
 return {token:b.token,...(typeof b.attempt === "string"?{attempt:b.attempt}:{}),...(consuming ? {name:(b.name as string).trim(),...(b.reassign===true?{reassign:true}:{})} : {})};
}
@Injectable()
export class InstallationEnrollmentService {
 constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService,
 private readonly agencies: AgencyDirectoryService) {}
 async requireOrigin() {
 const origin=agencyRequest.getStore()?.origin;
 if(!origin || !await this.agencies.allowsOrigin(origin)) throw new UnauthorizedException("Registered application origin required");
 return origin;
 }
 private async unit(manager: Pick<EntityManager,"query">, organizationId: string, unitId: string, requireActive = true) {
 // Schedule and zone writers acquire ordered agency rows before unit rows.
 // Separate statements make that order explicit instead of relying on a join plan.
 await manager.query(`select id from app_identity.organization
 where id=$1 or id=(select parent_organization_id from app_identity.organization where id=$1)
 order by id for share`,[organizationId]);
 const [unit] = await manager.query(`select u.id,u.name,u.call_sign as "callSign",a.name as "organizationName" from app_identity.operational_unit u
 join app_identity.organization a on a.id=u.organization_id join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
 where u.organization_id=$1 and u.id=$2 and (not $3::boolean or u.active) and a.active and g.active for share of u`,[organizationId,unitId,requireActive]);
 if (!unit) throw new NotFoundException("Active unit not found in this agency");
 return unit;
 }
 async issue(session: string, unitId: string, input?: unknown) {
 const minutes=enrollmentExpiryMinutes(input),name=enrollmentName(input);
 const origin=await this.requireOrigin();
 return this.database.transaction(async manager => {
 const actor=await this.sessions.requireCapability(session,"settings:write",manager);
 const unit=await this.unit(manager,actor.organization.id,unitId);
 const caPem=pairingCaPem();
 const token=randomBytes(32).toString("base64url");
 const [row]=mutationRows<{expiresAt:string}>(await manager.query(`insert into app_identity.unit_enrollment(id,organization_id,unit_id,issued_by,token_sha256,origin,installation_name,expires_at)
 values($1,$2,$3,$4,$5,$6,$8,clock_timestamp()+$7::integer*interval '1 minute') returning expires_at as "expiresAt"`,[randomUUID(),actor.organization.id,unitId,actor.user.id,digest(token),origin,minutes,name??unit.name]));
 await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,actor_id,event_type) values($1,$2,$3,'enrollment-issued')`,[actor.organization.id,unitId,actor.user.id]);
 return {token,origin,expiresAt:row!.expiresAt,caPem};
 });
 }
 async inventory(session: string, unitId: string, cursor?: string) {
 if(cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(cursor)) throw new UnprocessableEntityException("Invalid installation cursor");
 const actor=await this.sessions.requireCapability(session,"settings:write");
 await this.unit(this.database.manager,actor.organization.id,unitId,false);
 const rows=await this.database.query<InstallationSummary[]>(`select ${columns} from app_identity.installation_registration i
 where i.organization_id=$1 and i.unit_id=$2 and ($3::uuid is null or i.id>$3::uuid) order by i.id limit 51`,[actor.organization.id,unitId,cursor??null]);
 return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null};
 }
 async revoke(session: string, unitId: string, installationId: string) {
 await this.requireOrigin();
 return this.database.transaction(async manager => {
 const actor=await this.sessions.requireCapability(session,"settings:write",manager);
 // Inactive units still need inventory administration; do not rewrite history.
 const [registration]=await manager.query(`select id,revoked_at from app_identity.installation_registration
 where id=$1 and organization_id=$2 and unit_id=$3 for update`,[installationId,actor.organization.id,unitId]);
 if(!registration) throw new NotFoundException("Installation not found in this unit and agency");
 if(registration.revoked_at) return {revoked:true,sessionsRevoked:0};
 await manager.query(`update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1`,[installationId]);
 // Removing a unit pairing must not revoke the clinician identity/session.
 const sessionsRevoked=0;
 await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,installation_id,actor_id,event_type,details)
 values($1,$2,$3,$4,'installation-revoked',jsonb_build_object('scope','installation-registration','sessionsRevoked',$5::integer))`,
 [actor.organization.id,unitId,installationId,actor.user.id,sessionsRevoked]);
 return {revoked:true,sessionsRevoked};
 });
 }
 private async code(manager: Pick<EntityManager,"query">, token: string, lock: boolean) {
 const [row]=await manager.query(`select * from app_identity.unit_enrollment where token_sha256=$1 and origin=$2
 and consumed_at is null and expires_at>clock_timestamp() ${lock?'for update':''}`,[digest(token),agencyRequest.getStore()?.origin??""]);
 if (!row) throw new UnauthorizedException("Enrollment code is expired, invalid or already used");
 return row as {id:string;organization_id:string;unit_id:string;issued_by:string;installation_name:string|null};
 }
 async preview(input: unknown) {
 await this.requireOrigin();
 const {token}=enrollmentInput(input,false);
 return this.database.transaction(async manager=>{
 const row=await this.code(manager,token,false);
 const unit=await this.unit(manager,row.organization_id,row.unit_id);
 return {unitName:unit.name,callSign:unit.callSign,organizationName:unit.organizationName,installationName:row.installation_name??unit.name};
 });
 }
 private async lockCredentialIdentity(manager: Pick<EntityManager,"query">, credential: string) {
 await manager.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[digest(credential)]);
 const [known]=await manager.query(`select installation_identity_id from app_identity.installation_registration where credential_sha256=$1`,[digest(credential)]);
 if(known) await manager.query(`select pg_advisory_xact_lock(hashtextextended($1,1))`,[known.installation_identity_id]);
 }
 /** No issuance or receipt mutation. Only a locked, expired, never-consumed code proves non-commit. */
 async outcome(input: unknown, originalCredential?: string) {
 const origin=await this.requireOrigin(),body=enrollmentInput(input,true);
 if(!body.attempt || !originalCredential || !/^[A-Za-z0-9_-]{43}$/.test(originalCredential))throw new UnauthorizedException("Enrollment attempt is unavailable");
 const attempt=body.attempt;
 return this.database.transaction(async manager=>{
 // Same prefix/order as consume; another original cookie may contend for this code.
 await this.lockCredentialIdentity(manager,originalCredential);
 const [locked]=await manager.query(`select id from app_identity.unit_enrollment where token_sha256=$1 and origin=$2 for update`,[digest(body.token),origin]);
 if(!locked)return {status:"unavailable" as const};
 // Evaluate the clock after any lock wait, not in the row-locking scan's projection.
 const [receipt]=await manager.query(`select consumed_at,expires_at<=clock_timestamp() as expired,native_attempt_sha256,native_binding_sha256
 from app_identity.unit_enrollment where id=$1`,[locked.id]);
 if(!receipt)return {status:"unavailable" as const};
 if(!receipt.consumed_at)return {status:receipt.expired?"not-committed" as const:"pending" as const};
 const binding=enrollmentAttemptBinding(origin,body.token,body.name!,!!body.reassign,originalCredential);
 if(!sameEnrollmentDigest(receipt.native_attempt_sha256,enrollmentDigest(attempt)) || !sameEnrollmentDigest(receipt.native_binding_sha256,enrollmentDigest(binding)))throw new UnauthorizedException("Enrollment attempt is unavailable");
 // A live derived result is proved through the existing credential-authenticated GET.
 // Revoked/deleted/pruned results remain explicit recovery material, never a reset signal.
 return {status:"result-unavailable" as const};
 });
 }
 async consume(input: unknown, existingCredential?: string, existingSession?: string) {
 await this.requireOrigin();
 const body=enrollmentInput(input,true);
 const origin=agencyRequest.getStore()!.origin!;
 return this.database.transaction(async manager=>{
 if(!existingCredential || !/^[A-Za-z0-9_-]{43}$/.test(existingCredential)) throw new UnauthorizedException("Open enrollment in the intended browser first");
 await this.lockCredentialIdentity(manager,existingCredential);
 // Serialize every binding transition for the stable identity, including
 // revoked-cookie retries. Registration row locks also serialize session issuers.
 // Every retry acquires the same stable-identity guard as its original commit.
 const binding=body.attempt?enrollmentAttemptBinding(origin,body.token,body.name!,!!body.reassign,existingCredential):null;
 if(body.attempt) {
 const [receipt]=await manager.query(`select e.native_attempt_sha256,e.native_binding_sha256,e.installation_id,
 e.consumed_at>clock_timestamp()-interval '15 minutes' as retry_live
 from app_identity.unit_enrollment e where e.token_sha256=$1 and e.origin=$2 and e.consumed_at is not null`,[digest(body.token),origin]);
 if(receipt) {
 if(!receipt.retry_live || !sameEnrollmentDigest(receipt.native_attempt_sha256,enrollmentDigest(body.attempt)) || !sameEnrollmentDigest(receipt.native_binding_sha256,enrollmentDigest(binding!))) throw new UnauthorizedException("Enrollment attempt is unavailable");
 const credential=enrollmentAttemptCredential(body.attempt,binding!);
 const [live]=await manager.query(`select ${columns} from app_identity.installation_registration i
 where i.id=$1 and i.credential_sha256=$2 and i.revoked_at is null for share of i`,[receipt.installation_id,digest(credential)]);
 if(!live) throw new UnauthorizedException("Enrollment attempt is unavailable");
 await this.unit(manager,live.organizationId,live.unitId);
 // Waiting on live registration/unit authority cannot extend retry eligibility.
 const [stillLive]=await manager.query(`select id from app_identity.unit_enrollment where token_sha256=$1 and origin=$2
 and consumed_at>clock_timestamp()-interval '15 minutes'`,[digest(body.token),origin]);
 if(!stillLive) throw new UnauthorizedException("Enrollment attempt is unavailable");
 return {installation:live as InstallationSummary,credential,...(body.reassign?{reassigned:true}:{})};
 }
 }
 const [previous]=await manager.query(`select i.*,exists(select 1 from app_identity.installation_event e
 where e.installation_id=i.id and e.event_type='installation-reassigned') as retired
 from app_identity.installation_registration i where credential_sha256=$1 for update of i`,[digest(existingCredential)]);
 if(previous) {
 const [live]=await manager.query(`select id from app_identity.installation_registration where installation_identity_id=$1 and revoked_at is null`,[previous.installation_identity_id]);
 if(previous.retired || (live && live.id!==previous.id)) throw new ConflictException("This installation credential is retired or replaced");
 if(!previous.revoked_at && !body.reassign) throw new ConflictException("This installation is already enrolled; use administrator reassignment");
 }
 if(body.reassign && (!previous || previous.revoked_at)) throw new ConflictException("Reassignment requires a live installation registration; this credential is unavailable");
 const row=await this.code(manager,body.token,true);
 await this.unit(manager,row.organization_id,row.unit_id);
 const credential=body.attempt?enrollmentAttemptCredential(body.attempt,binding!):previous?randomBytes(32).toString("base64url"):existingCredential,id=randomUUID(),identityId=previous?.installation_identity_id??randomUUID();
 let sessionsRevoked=0;
 if(body.reassign) {
 await manager.query(`update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1`,[previous.id]);
 sessionsRevoked=await revokeRegistrationSessions(manager,previous.id);
 // Even an unbound cookie from this browser must never carry personal evidence
 // into reassignment. A replacement session can only be created by fresh login.
 if(existingSession) await manager.query(`update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='installation_revoked'
 where token_sha256=$1 and revoked_at is null and browser_origin=$2`,[digest(existingSession),agencyRequest.getStore()?.origin??""]);
 }
 if(!previous) await manager.query(`insert into app_identity.installation_identity(id) values($1)`,[identityId]);
 const [installation]=mutationRows<InstallationSummary>(await manager.query(`insert into app_identity.installation_registration as i(id,organization_id,unit_id,name,credential_sha256,installation_identity_id)
 values($1,$2,$3,$4,$5,$6) returning ${columns}`,[id,row.organization_id,row.unit_id,row.installation_name??body.name,digest(credential),identityId]));
 // Enrollment may complete while a clinician is already signed in. Attach only
 // that live same-origin cookie session; stale cookies never block independent pairing.
 if(existingSession && !body.reassign) await manager.query(`update app_identity.app_session set installation_registration_id=$2
 where token_sha256=$1 and installation_registration_id is null and revoked_at is null
 and expires_at>clock_timestamp() and browser_origin=$3 and organization_id=$4
 and app_identity.user_can_access_organization(user_id,$4)
 and exists(select 1 from app_identity.app_user u where u.id=app_session.user_id and u.active)
 and app_identity.session_authentication_valid(app_session)`,
 [digest(existingSession),id,agencyRequest.getStore()?.origin??"",row.organization_id]);
 // Recheck time after acquiring locks: a waiter cannot consume an expired code.
 const consumed=mutationRows(await manager.query(`update app_identity.unit_enrollment set consumed_at=clock_timestamp(),installation_id=$2,native_attempt_sha256=$3,native_binding_sha256=$4
 where id=$1 and consumed_at is null and expires_at>clock_timestamp() returning id`,[row.id,id,body.attempt?digest(body.attempt):null,binding?digest(binding):null]));
 if(!consumed.length) throw new UnauthorizedException("Enrollment code is expired, invalid or already used");
 await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,installation_id,actor_id,event_type)
 values($1,$2,$3,$4,'installation-enrolled')`,[row.organization_id,row.unit_id,id,row.issued_by]);
 if(body.reassign) await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,installation_id,actor_id,event_type,details)
 values($1,$2,$3,$4,'installation-reassigned',jsonb_build_object('replacementRegistrationId',$5::text,'sessionsRevoked',$6::integer))`,
 [previous.organization_id,previous.unit_id,previous.id,row.issued_by,id,sessionsRevoked]);
 return {installation:installation!,credential,...(body.reassign?{reassigned:true}:{})};
 });
 }
 async current(credential?: string) {
 await this.requireOrigin();
 if(!credential) throw new UnauthorizedException("Enrollment required for this browser installation");
 const [row]=await this.database.query<(InstallationSummary & {unitName:string})[]>(`select ${columns},u.name as "unitName" from app_identity.installation_registration i
 join app_identity.operational_unit u on u.id=i.unit_id and u.organization_id=i.organization_id
 join app_identity.organization a on a.id=i.organization_id join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
 where i.credential_sha256=$1 and i.revoked_at is null and u.active and a.active and g.active
 and exists(select 1 from app_identity.unit_enrollment e where e.installation_id=i.id and e.origin=$2)`,[digest(credential),agencyRequest.getStore()?.origin??""]);
 if(!row) throw new UnauthorizedException("Enrollment required for this browser installation");
 return row;
 }
}
