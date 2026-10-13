import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { AgencyDirectoryService } from "../sessions/agency-directory.service.js";
import { agencyRequest } from "../sessions/agency-context.js";
import { mutationRows } from "../database/mutation-result.js";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const columns = `i.id,i.installation_identity_id as "installationId",i.organization_id as "organizationId",i.unit_id as "unitId",i.name,i.enrolled_at as "enrolledAt",i.revoked_at as "revokedAt"`;
export type InstallationSummary = { id: string; installationId: string; organizationId: string; unitId: string; name: string; enrolledAt: string; revokedAt: string | null };
export function enrollmentInput(input: unknown, consuming: boolean): { token: string; name?: string } {
 if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnprocessableEntityException("Invalid enrollment");
 const b = input as Record<string, unknown>;
 if (Object.keys(b).some(key => !(consuming ? ["token","name","confirmInstallation"] : ["token"]).includes(key)) ||
 typeof b.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.token)) throw new UnprocessableEntityException("Invalid enrollment code");
 if (consuming && (b.confirmInstallation !== true || typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 || /[\u0000-\u001f\u007f]/u.test(b.name))) {
 throw new UnprocessableEntityException("Name and explicit intended installation confirmation are required");
 }
 return {token:b.token,...(consuming ? {name:(b.name as string).trim()} : {})};
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
 private async unit(manager: Pick<EntityManager,"query">, organizationId: string, unitId: string) {
 const [unit] = await manager.query(`select u.id,u.name,u.call_sign as "callSign" from app_identity.operational_unit u
 join app_identity.organization a on a.id=u.organization_id join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
 where u.organization_id=$1 and u.id=$2 and u.active and a.active and g.active for share of u,a,g`,[organizationId,unitId]);
 if (!unit) throw new NotFoundException("Active unit not found in this agency");
 return unit;
 }
 async issue(session: string, unitId: string) {
 const origin=await this.requireOrigin();
 return this.database.transaction(async manager => {
 const actor=await this.sessions.requireCapability(session,"settings:write",manager);
 await this.unit(manager,actor.organization.id,unitId);
 const token=randomBytes(32).toString("base64url");
 const [row]=mutationRows<{expiresAt:string}>(await manager.query(`insert into app_identity.unit_enrollment(id,organization_id,unit_id,issued_by,token_sha256,origin)
 values($1,$2,$3,$4,$5,$6) returning expires_at as "expiresAt"`,[randomUUID(),actor.organization.id,unitId,actor.user.id,digest(token),origin]));
 await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,actor_id,event_type) values($1,$2,$3,'enrollment-issued')`,[actor.organization.id,unitId,actor.user.id]);
 return {token,origin,expiresAt:row!.expiresAt};
 });
 }
 async inventory(session: string, unitId: string, cursor?: string) {
 if(cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(cursor)) throw new UnprocessableEntityException("Invalid installation cursor");
 const actor=await this.sessions.requireCapability(session,"settings:write");
 await this.unit(this.database.manager,actor.organization.id,unitId);
 const rows=await this.database.query<InstallationSummary[]>(`select ${columns} from app_identity.installation_registration i
 where i.organization_id=$1 and i.unit_id=$2 and ($3::uuid is null or i.id>$3::uuid) order by i.id limit 51`,[actor.organization.id,unitId,cursor??null]);
 return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null};
 }
 private async code(manager: Pick<EntityManager,"query">, token: string, lock: boolean) {
 const [row]=await manager.query(`select * from app_identity.unit_enrollment where token_sha256=$1 and origin=$2
 and consumed_at is null and expires_at>clock_timestamp() ${lock?'for update':''}`,[digest(token),agencyRequest.getStore()?.origin??""]);
 if (!row) throw new UnauthorizedException("Enrollment code is expired, invalid or already used");
 return row as {id:string;organization_id:string;unit_id:string;issued_by:string};
 }
 async preview(input: unknown) {
 await this.requireOrigin();
 const {token}=enrollmentInput(input,false);
 return this.database.transaction(async manager=>{
 const row=await this.code(manager,token,false);
 const unit=await this.unit(manager,row.organization_id,row.unit_id);
 return {unitName:unit.name,callSign:unit.callSign};
 });
 }
 async consume(input: unknown, existingCredential?: string) {
 await this.requireOrigin();
 const body=enrollmentInput(input,true);
 return this.database.transaction(async manager=>{
 if(!existingCredential || !/^[A-Za-z0-9_-]{43}$/.test(existingCredential)) throw new UnauthorizedException("Open enrollment in the intended browser first");
 await manager.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[digest(existingCredential)]);
 if(existingCredential) {
 const [old]=await manager.query(`select id from app_identity.installation_registration where credential_sha256=$1 and revoked_at is null`,[digest(existingCredential)]);
 if(old) throw new ConflictException("This installation is already enrolled; use administrator reassignment");
 }
 const row=await this.code(manager,body.token,true);
 await this.unit(manager,row.organization_id,row.unit_id);
 const credential=existingCredential,id=randomUUID(),identityId=randomUUID();
 await manager.query(`insert into app_identity.installation_identity(id) values($1)`,[identityId]);
 const [installation]=mutationRows<InstallationSummary>(await manager.query(`insert into app_identity.installation_registration as i(id,organization_id,unit_id,name,credential_sha256,installation_identity_id)
 values($1,$2,$3,$4,$5,$6) returning ${columns}`,[id,row.organization_id,row.unit_id,body.name,digest(credential),identityId]));
 // Recheck time after acquiring locks: a waiter cannot consume an expired code.
 const consumed=mutationRows(await manager.query(`update app_identity.unit_enrollment set consumed_at=clock_timestamp(),installation_id=$2
 where id=$1 and consumed_at is null and expires_at>clock_timestamp() returning id`,[row.id,id]));
 if(!consumed.length) throw new UnauthorizedException("Enrollment code is expired, invalid or already used");
 await manager.query(`insert into app_identity.installation_event(organization_id,unit_id,installation_id,actor_id,event_type)
 values($1,$2,$3,$4,'installation-enrolled')`,[row.organization_id,row.unit_id,id,row.issued_by]);
 return {installation:installation!,credential};
 });
 }
 async current(credential?: string) {
 await this.requireOrigin();
 if(!credential) throw new UnauthorizedException("Enrollment required for this browser installation");
 const [row]=await this.database.query<InstallationSummary[]>(`select ${columns} from app_identity.installation_registration i
 join app_identity.operational_unit u on u.id=i.unit_id and u.organization_id=i.organization_id
 join app_identity.organization a on a.id=i.organization_id join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
 where i.credential_sha256=$1 and i.revoked_at is null and u.active and a.active and g.active
 and exists(select 1 from app_identity.unit_enrollment e where e.installation_id=i.id and e.origin=$2)`,[digest(credential),agencyRequest.getStore()?.origin??""]);
 if(!row) throw new UnauthorizedException("Enrollment required for this browser installation");
 return row;
 }
}
