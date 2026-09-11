import { randomUUID } from "node:crypto";
import {
  ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  AdminCapabilityCatalog, AdminCapabilityOption, AdminRole, ClinicianSession, SaveAdminRoleCommand
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;
const MAX_NOTE = 500;

type RoleRow = {
  id: string; organization_id: string; display_name: string; description: string | null;
  active: boolean; protected: boolean; current_version_id: string; version: number | string;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRoleName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function databaseCode(reason: unknown): string | undefined {
  return record(reason) && typeof reason.code === "string" ? reason.code : undefined;
}

@Injectable()
export class RoleAuthoringService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async capabilities(token: string): Promise<AdminCapabilityCatalog> {
    const session = await this.sessions.requireCapability(token, "roles:read");
    const rows = await this.dataSource.query<Array<{
      key: string; description: string; administrative: boolean; system_only: boolean;
      prerequisites: string[] | string | null; owner: boolean;
    }>>(`
      select capability.key, capability.description, capability.administrative, capability.system_only,
        coalesce(array_agg(required.prerequisite_key order by required.prerequisite_key)
          filter (where required.prerequisite_key is not null), '{}') prerequisites,
        exists (select 1 from app_identity.installation_owner
          where organization_id = $1 and user_id = $2) owner
      from app_identity.capability capability
      left join app_identity.capability_prerequisite required
        on required.capability_key = capability.key
      where not capability.system_only
      group by capability.key
      order by capability.administrative desc, capability.key
    `, [session.organization.id, session.user.id]);
    const possessed = new Set(session.capabilities ?? []);
    return { items: rows.map((row) => ({ key: row.key, description: row.description,
      administrative: row.administrative, systemOnly: row.system_only,
      prerequisites: this.textArray(row.prerequisites), mutable: row.owner || possessed.has(row.key) })) };
  }

  async create(token: string, input: unknown): Promise<AdminRole> {
    const session = await this.sessions.requireCapability(token, "roles:write");
    const body = this.body(input, false);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`custom-roles:${session.organization.id}`]);
        const catalog = await this.validateDefinition(manager, session, body.capabilityKeys);
        await this.assertNameAvailable(manager, session.organization.id, body.displayName);
        const roleId = randomUUID();
        const versionId = randomUUID();
        await manager.query(`
          insert into app_identity.role
            (id, organization_id, display_name, description, current_version_id, created_by, note)
          values ($1, $2, $3, $4, $5, $6, $7)
        `, [roleId, session.organization.id, body.displayName, body.description, versionId, session.user.id, body.note]);
        await manager.query(`
          insert into app_identity.role_version
            (id, organization_id, role_id, version, created_by, note)
          values ($1, $2, $3, 1, $4, $5)
        `, [versionId, session.organization.id, roleId, session.user.id, body.note]);
        await this.insertCapabilities(manager, session.organization.id, roleId, versionId, body.capabilityKeys);
        return this.result(roleId, body, 1, catalog, 0);
      });
    } catch (reason) {
      this.translateDatabaseError(reason);
    }
  }

  async update(token: string, roleId: string, input: unknown): Promise<AdminRole> {
    const session = await this.sessions.requireCapability(token, "roles:write");
    const body = this.body(input, true);
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        const rows = await manager.query<RoleRow[]>(`
          select role.*, version.version
          from app_identity.role role
          join app_identity.role_version version
            on version.organization_id = role.organization_id and version.role_id = role.id
            and version.id = role.current_version_id
          where role.id = $1 and role.organization_id = $2
          for update of role, version
        `, [roleId, session.organization.id]);
        const role = rows[0];
        if (!role) throw new NotFoundException(`Role ${roleId} was not found`);
        if (role.protected) throw new ForbiddenException("Protected roles cannot be edited");
        if (!role.active) throw new ConflictException("A deactivated role cannot be edited");
        const actualVersion = Number(role.version);
        if (actualVersion !== body.expectedVersion) throw new ConflictException({
          message: "Role version is stale", expectedVersion: body.expectedVersion, actualVersion
        });
        const selfAssignments = await manager.query<Array<{ assigned: boolean }>>(`
          select exists (
            select 1 from app_identity.user_role_assignment
            where organization_id = $1 and user_id = $2 and role_id = $3 and ended_at is null
          ) assigned
        `, [session.organization.id, session.user.id, roleId]);
        if (selfAssignments[0]?.assigned) {
          throw new ForbiddenException("You cannot edit a role currently assigned to your own account");
        }
        await this.assertNameAvailable(manager, session.organization.id, body.displayName, roleId);
        const currentRows = await manager.query<Array<{ capability_key: string }>>(`
          select capability_key from app_identity.role_version_capability
          where organization_id = $1 and role_id = $2 and role_version_id = $3
          order by capability_key
        `, [session.organization.id, roleId, role.current_version_id]);
        const current = new Set(currentRows.map(({ capability_key }) => capability_key));
        const catalog = await this.validateDefinition(manager, session, body.capabilityKeys, current);
        const versionId = randomUUID();
        const nextVersion = actualVersion + 1;
        await manager.query(`
          insert into app_identity.role_version
            (id, organization_id, role_id, version, created_by, note)
          values ($1, $2, $3, $4, $5, $6)
        `, [versionId, session.organization.id, roleId, nextVersion, session.user.id, body.note]);
        await this.insertCapabilities(manager, session.organization.id, roleId, versionId, body.capabilityKeys);
        const updated = await manager.query<Array<{ id: string }>>(`
          update app_identity.role
          set display_name = $3, description = $4, current_version_id = $5, note = $6
          where id = $1 and organization_id = $2 and current_version_id = $7
          returning id
        `, [roleId, session.organization.id, body.displayName, body.description, versionId, body.note,
          role.current_version_id]);
        if (!updated[0]) throw new ConflictException("Role version is stale");
        const counts = await manager.query<Array<{ count: number | string }>>(`
          select count(distinct user_id) count from app_identity.user_role_assignment
          where organization_id = $1 and role_id = $2 and ended_at is null
        `, [session.organization.id, roleId]);
        return this.result(roleId, body, nextVersion, catalog, Number(counts[0]?.count ?? 0));
      });
    } catch (reason) {
      this.translateDatabaseError(reason);
    }
  }

  private body(input: unknown, editing: boolean): SaveAdminRoleCommand & { note: string | null; expectedVersion?: number } {
    if (!record(input) || typeof input.displayName !== "string" || !Array.isArray(input.capabilityKeys) ||
        input.capabilityKeys.some((key) => typeof key !== "string")) {
      throw new UnprocessableEntityException("displayName and capabilityKeys are required");
    }
    const displayName = normalizeRoleName(input.displayName);
    if (!displayName || displayName.length > MAX_NAME || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
      throw new UnprocessableEntityException(`Role name must be between 1 and ${MAX_NAME} valid characters`);
    }
    let description: string | null = null;
    if (input.description !== undefined && input.description !== null) {
      if (typeof input.description !== "string") throw new UnprocessableEntityException("description must be text");
      description = input.description.normalize("NFC").trim() || null;
      if (description && (description.length > MAX_DESCRIPTION || /[\p{Cc}\p{Cf}]/u.test(description))) {
        throw new UnprocessableEntityException(`Description must be at most ${MAX_DESCRIPTION} valid characters`);
      }
    }
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
      if (typeof input.note !== "string") throw new UnprocessableEntityException("note must be text");
      note = input.note.normalize("NFC").trim() || null;
      if (note && (note.length > MAX_NOTE || /[\p{Cc}\p{Cf}]/u.test(note))) {
        throw new UnprocessableEntityException(`Change note must be at most ${MAX_NOTE} valid characters`);
      }
    }
    const capabilityKeys = input.capabilityKeys as string[];
    if (!capabilityKeys.length) throw new UnprocessableEntityException("Select at least one capability");
    if (new Set(capabilityKeys).size !== capabilityKeys.length) {
      throw new UnprocessableEntityException("Each capability may be selected only once");
    }
    const expectedVersion = input.expectedVersion;
    if (editing && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) {
      throw new UnprocessableEntityException("expectedVersion must be a positive integer");
    }
    return { displayName, description, capabilityKeys: [...capabilityKeys].sort(), note,
      ...(editing ? { expectedVersion: Number(expectedVersion) } : {}) };
  }

  private async validateDefinition(manager: EntityManager, session: ClinicianSession, keys: string[], current = new Set<string>())
  : Promise<Map<string, AdminCapabilityOption>> {
    const rows = await manager.query<Array<{
      key: string; description: string; administrative: boolean; system_only: boolean;
      prerequisite_key: string | null;
    }>>(`
      select capability.key, capability.description, capability.administrative,
        capability.system_only, required.prerequisite_key
      from app_identity.capability capability
      left join app_identity.capability_prerequisite required on required.capability_key = capability.key
      where capability.key = any($1::text[]) and not capability.system_only
      order by capability.key, required.prerequisite_key
    `, [keys]);
    const catalog = new Map<string, AdminCapabilityOption>();
    for (const row of rows) {
      const item = catalog.get(row.key) ?? { key: row.key, description: row.description,
        administrative: row.administrative, systemOnly: row.system_only, prerequisites: [], mutable: true };
      if (row.prerequisite_key) item.prerequisites.push(row.prerequisite_key);
      catalog.set(row.key, item);
    }
    if (catalog.size !== keys.length) {
      throw new UnprocessableEntityException("One or more capabilities are unavailable for custom roles");
    }
    const selected = new Set(keys);
    const missing = [...catalog.values()].flatMap((item) => item.prerequisites
      .filter((required) => !selected.has(required)).map((required) => `${item.key} requires ${required}`));
    if (missing.length) throw new UnprocessableEntityException({ message: "Capability prerequisites are missing", findings: missing });
    const owners = await manager.query<Array<{ owner: boolean }>>(`
      select exists (
        select 1 from app_identity.installation_owner
        where organization_id = $1 and user_id = $2
      ) owner
    `, [session.organization.id, session.user.id]);
    if (!owners[0]?.owner) {
      const possessed = new Set(session.capabilities ?? []);
      const changed = keys.filter((key) => !current.has(key)).concat([...current].filter((key) => !selected.has(key)));
      if (changed.some((key) => !possessed.has(key))) {
        throw new ForbiddenException("You may change only capabilities currently granted to your account");
      }
    }
    return catalog;
  }

  private async assertNameAvailable(manager: EntityManager, organizationId: string, displayName: string, exceptId?: string) {
    const rows = await manager.query<Array<{ protected: boolean }>>(`
      select protected from app_identity.role
      where organization_id = $1 and lower(display_name) = lower($2)
        and ($3::uuid is null or id <> $3)
        and (active or protected)
      limit 1
    `, [organizationId, displayName, exceptId ?? null]);
    if (rows[0]) throw new ConflictException(rows[0].protected
      ? "That name belongs to a protected role" : "An active role already uses that name");
  }

  private async insertCapabilities(manager: EntityManager, organizationId: string, roleId: string,
    versionId: string, keys: string[]) {
    await manager.query(`
      insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key)
      select $1, $2, $3, capability_key from unnest($4::text[]) capability_key
    `, [organizationId, versionId, roleId, keys]);
  }

  private result(id: string, body: SaveAdminRoleCommand, version: number,
    catalog: Map<string, AdminCapabilityOption>, assigneeCount: number): AdminRole {
    return { id, displayName: body.displayName, description: body.description, active: true, protected: false,
      version, assigneeCount, capabilities: body.capabilityKeys.map((key) => {
        const { prerequisites: _prerequisites, mutable: _mutable, ...capability } = catalog.get(key)!;
        return capability;
      }) };
  }

  private textArray(value: string[] | string | null): string[] {
    if (Array.isArray(value)) return value;
    if (!value || value === "{}") return [];
    return value.slice(1, -1).split(",").filter(Boolean);
  }

  private translateDatabaseError(reason: unknown): never {
    if (reason instanceof ConflictException || reason instanceof ForbiddenException ||
        reason instanceof NotFoundException || reason instanceof UnprocessableEntityException) throw reason;
    if (databaseCode(reason) === "23505") throw new ConflictException("An active role already uses that name");
    if (databaseCode(reason) === "23514" || databaseCode(reason) === "P0001") {
      throw new UnprocessableEntityException("The role definition violates authorization rules");
    }
    throw reason;
  }
}
