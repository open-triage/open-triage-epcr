import { randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import type { OperationalUnitPage, OperationalUnitSummary, SaveOperationalUnitCommand } from "@open-triage/contracts";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { mutationRows } from "../database/mutation-result.js";

export function validateUnit(input: unknown, editing: boolean): SaveOperationalUnitCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UnprocessableEntityException("Invalid unit");
  const body = input as Record<string, unknown>;
  const allowed = ["name", "callSign", "active", ...(editing ? ["expectedRevision"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new UnprocessableEntityException("Unknown unit field");
  for (const key of ["name", "callSign"]) {
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > (key === "name" ? 100 : 40)
      || /[\u0000-\u001f\u007f]/u.test(body[key])) throw new UnprocessableEntityException(`Invalid ${key}`);
  }
  if (typeof body.active !== "boolean" || (editing && (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1))) {
    throw new UnprocessableEntityException("Invalid unit state or revision");
  }
  return { name: (body.name as string).trim(), callSign: (body.callSign as string).trim(), active: body.active,
    ...(editing ? { expectedRevision: Number(body.expectedRevision) } : {}) };
}
const columns = `id,organization_id as "organizationId",name,call_sign as "callSign",active,revision`;
@Injectable()
export class UnitsService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}
  async list(token: string, cursor?: string): Promise<OperationalUnitPage> {
    const actor = await this.sessions.requireCapability(token, "settings:read");
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(cursor)) {
      throw new UnprocessableEntityException("Invalid unit cursor");
    }
    const rows = await this.database.query<OperationalUnitSummary[]>(`select ${columns},
      exists(select 1 from app_identity.unit_schedule_selection selection
        where selection.organization_id=operational_unit.organization_id and selection.unit_id=operational_unit.id
          and selection.effective_at<=clock_timestamp() and selection.schedule_id is not null
          and selection.revision=(select max(latest.revision) from app_identity.unit_schedule_selection latest
            where latest.unit_id=operational_unit.id and latest.effective_at<=clock_timestamp())) as "scheduleSelected",
      exists(select 1 from app_identity.installation_registration registration
        where registration.organization_id=operational_unit.organization_id and registration.unit_id=operational_unit.id
          and registration.revoked_at is null) as enrolled
      from app_identity.operational_unit where organization_id=$1 and ($2::uuid is null or id>$2::uuid)
      order by id limit 51`, [actor.organization.id, cursor ?? null]);
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  }
  async save(token: string, id: string | null, input: unknown): Promise<OperationalUnitSummary> {
    const body = validateUnit(input, !!id);
    try {
      return await this.database.transaction(async manager => {
        const actor = await this.sessions.requireCapability(token, "settings:write", manager);
        let before: OperationalUnitSummary | undefined;
        if (id) {
          [before] = await manager.query<OperationalUnitSummary[]>(`select ${columns} from app_identity.operational_unit
            where organization_id=$1 and id=$2 for update`, [actor.organization.id,id]);
          if (!before) throw new NotFoundException("Unit not found in this agency");
          if (Number(before.revision) !== body.expectedRevision) throw new ConflictException("Unit changed; reload before saving");
        }
        const rows = id ? mutationRows<OperationalUnitSummary>(await manager.query(`update app_identity.operational_unit
          set name=$3,call_sign=$4,active=$5,revision=revision+1 where organization_id=$1 and id=$2 returning ${columns}`,
          [actor.organization.id,id,body.name,body.callSign,body.active])) : await manager.query<OperationalUnitSummary[]>(`
          insert into app_identity.operational_unit(id,organization_id,name,call_sign,active)
          values ($1,$2,$3,$4,$5) returning ${columns}`, [randomUUID(),actor.organization.id,body.name,body.callSign,body.active]);
        const unit = rows[0]!;
        await manager.query(`insert into app_identity.operational_unit_event(organization_id,unit_id,actor_id,details)
          values ($1,$2,$3,$4::jsonb)`, [actor.organization.id,unit.id,actor.user.id,JSON.stringify({ before: before ?? null, after: unit })]);
        return unit;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new ConflictException("That call sign is already assigned in this agency, including inactive units");
      }
      throw error;
    }
  }
}
