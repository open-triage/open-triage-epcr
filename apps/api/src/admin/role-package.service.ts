import { createHash } from "node:crypto";
import {
  ConflictException, ForbiddenException, Injectable, UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  ClinicianSession, PortableCustomRolePackage, PortableRoleImportPreview, PortableRoleImportResult
} from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { normalizeRoleName } from "./role-authoring.service.js";

const SCHEMA = "open-triage.custom-roles";
const SCHEMA_VERSION = "1.0.0";
const MAX_ROLES = 250;
const MAX_VERSIONS = 2_500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PortableRole = PortableCustomRolePackage["roles"][number];
type PortableVersion = PortableRole["versions"][number];
type ExistingRoleRow = {
  id: string; protected: boolean; active: boolean; current_version_id: string;
};
type ExistingVersionRow = {
  role_id: string; id: string; version: number | string; display_name: string;
  description: string | null; capability_keys: string[] | string | null;
};
type CapabilityRow = { key: string; system_only: boolean; prerequisite_key: string | null };
type PreparedImport = {
  package: PortableCustomRolePackage;
  existing: Map<string, ExistingRoleRow>;
  existingVersions: Map<string, ExistingVersionRow[]>;
  preview: PortableRoleImportPreview;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

@Injectable()
export class RolePackageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async export(token: string): Promise<PortableCustomRolePackage> {
    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "roles:read", manager);
      const rows = await manager.query<ExistingVersionRow[]>(`
        select role.id role_id, version.id, version.version, version.display_name, version.description,
          coalesce(array_agg(definition.capability_key order by definition.capability_key)
            filter (where definition.capability_key is not null), '{}') capability_keys
        from app_identity.role role
        join app_identity.role_version version on version.organization_id = role.organization_id
          and version.role_id = role.id
        left join app_identity.role_version_capability definition
          on definition.organization_id = version.organization_id and definition.role_id = version.role_id
          and definition.role_version_id = version.id
        where role.organization_id = $1 and not role.protected and role.system_key is null and not role.hidden
        group by role.id, version.id
        order by role.id, version.version
      `, [session.organization.id]);
      const currentRows = await manager.query<Array<{ id: string; current_version_id: string }>>(`
        select id, current_version_id from app_identity.role
        where organization_id = $1 and not protected and system_key is null and not hidden order by id
      `, [session.organization.id]);
      const grouped = new Map<string, PortableVersion[]>();
      for (const row of rows) grouped.set(row.role_id, [...(grouped.get(row.role_id) ?? []), this.portableVersion(row)]);
      const result: PortableCustomRolePackage = { schema: SCHEMA, schemaVersion: SCHEMA_VERSION,
        roles: currentRows.map((role) => ({ id: role.id, currentVersionId: role.current_version_id,
          versions: grouped.get(role.id) ?? [] })) };
      await this.audit(manager, session, "role.package_export", this.digest(result), {
        roleCount: result.roles.length, versionCount: result.roles.reduce((sum, role) => sum + role.versions.length, 0)
      });
      return result;
    });
  }

  async preview(token: string, input: unknown): Promise<PortableRoleImportPreview> {
    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "roles:read", manager);
      const prepared = await this.prepare(manager, session, input, false);
      await this.audit(manager, session, "role.package_preview", this.digest(prepared.package), {
        roleCount: prepared.preview.roleCount, createdRoleCount: prepared.preview.createdRoleCount,
        updatedRoleCount: prepared.preview.updatedRoleCount,
        unchangedRoleCount: prepared.preview.unchangedRoleCount,
        affectedAssigneeCount: prepared.preview.affectedAssigneeCount
      });
      return prepared.preview;
    });
  }

  async import(token: string, input: unknown, now = new Date()): Promise<PortableRoleImportResult> {
    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        const session = await this.sessions.requireCapability(token, "roles:write", manager, now);
        await this.sessions.requireRecentReauthentication(token, manager, now);
        await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`custom-roles:${session.organization.id}`]);
        const prepared = await this.prepare(manager, session, input, true);
        for (const role of prepared.package.roles) await this.activate(manager, session, role, prepared.existing.get(role.id));
        await this.audit(manager, session, "role.package_import", this.digest(prepared.package), {
          roleCount: prepared.preview.roleCount, createdRoleCount: prepared.preview.createdRoleCount,
          updatedRoleCount: prepared.preview.updatedRoleCount,
          unchangedRoleCount: prepared.preview.unchangedRoleCount,
          affectedAssigneeCount: prepared.preview.affectedAssigneeCount
        });
        return { ...prepared.preview, importedAt: now.toISOString() };
      });
    } catch (reason) {
      if (reason instanceof ConflictException || reason instanceof ForbiddenException ||
          reason instanceof UnprocessableEntityException) throw reason;
      if (record(reason) && (reason.code === "23505" || reason.code === "40001")) {
        throw new ConflictException("The role package conflicts with a concurrent authorization change");
      }
      throw reason;
    }
  }

  private async prepare(manager: EntityManager, session: ClinicianSession, input: unknown,
    enforceCeiling: boolean): Promise<PreparedImport> {
    const portable = this.parse(input);
    const roleIds = portable.roles.map(({ id }) => id);
    const existingRows = roleIds.length ? await manager.query<ExistingRoleRow[]>(`
      select id, protected, active, current_version_id from app_identity.role
      where organization_id = $1 and id = any($2::uuid[]) for update
    `, [session.organization.id, roleIds]) : [];
    if (existingRows.some((row) => row.protected)) {
      throw new ForbiddenException("Protected role identities cannot be imported");
    }
    const existing = new Map(existingRows.map((row) => [row.id, row]));
    const existingVersionRows = roleIds.length ? await manager.query<ExistingVersionRow[]>(`
      select version.role_id, version.id, version.version, version.display_name, version.description,
        coalesce(array_agg(definition.capability_key order by definition.capability_key)
          filter (where definition.capability_key is not null), '{}') capability_keys
      from app_identity.role_version version
      left join app_identity.role_version_capability definition
        on definition.organization_id = version.organization_id and definition.role_id = version.role_id
        and definition.role_version_id = version.id
      where version.organization_id = $1 and version.role_id = any($2::uuid[])
      group by version.role_id, version.id order by version.role_id, version.version
    `, [session.organization.id, roleIds]) : [];
    const existingVersions = new Map<string, ExistingVersionRow[]>();
    for (const row of existingVersionRows) existingVersions.set(row.role_id,
      [...(existingVersions.get(row.role_id) ?? []), row]);
    this.assertHistory(portable, existingVersions);
    await this.assertVersionIdsAvailable(manager, portable);
    const allKeys = [...new Set(portable.roles.flatMap((role) => role.versions.flatMap((version) => version.capabilityKeys)))];
    const catalog = await this.catalog(manager, allKeys);
    this.assertCapabilities(portable, catalog);
    if (enforceCeiling) await this.assertCeiling(manager, session, allKeys);
    await this.assertNamesAvailable(manager, session.organization.id, portable);
    const counts = roleIds.length ? await manager.query<Array<{ role_id: string; count: number | string }>>(`
      select role_id, count(distinct user_id) count from app_identity.user_role_assignment
      where organization_id = $1 and role_id = any($2::uuid[]) and ended_at is null group by role_id
    `, [session.organization.id, roleIds]) : [];
    const assignees = new Map(counts.map((row) => [row.role_id, Number(row.count)]));
    const changes = portable.roles.map((role) => {
      const before = this.currentCapabilities(existing.get(role.id), existingVersions.get(role.id));
      const after = new Set(role.versions.find(({ id }) => id === role.currentVersionId)!.capabilityKeys);
      return { roleId: role.id, added: [...after].filter((key) => !before.has(key)).sort(),
        removed: [...before].filter((key) => !after.has(key)).sort(),
        affectedAssigneeCount: assignees.get(role.id) ?? 0 };
    });
    const updated = portable.roles.filter((role) => {
      const prior = existing.get(role.id);
      return Boolean(prior && (prior.current_version_id !== role.currentVersionId || !prior.active));
    }).length;
    const created = portable.roles.filter((role) => !existing.has(role.id)).length;
    const preview: PortableRoleImportPreview = { schemaVersion: SCHEMA_VERSION, roleCount: portable.roles.length,
      createdRoleCount: created, updatedRoleCount: updated,
      unchangedRoleCount: portable.roles.length - created - updated,
      affectedAssigneeCount: changes.filter(({ added, removed }) => added.length || removed.length)
        .reduce((sum, change) => sum + change.affectedAssigneeCount, 0), capabilityChanges: changes };
    return { package: portable, existing, existingVersions, preview };
  }

  private parse(input: unknown): PortableCustomRolePackage {
    if (!record(input) || !exactKeys(input, ["roles", "schema", "schemaVersion"]) ||
        input.schema !== SCHEMA || input.schemaVersion !== SCHEMA_VERSION || !Array.isArray(input.roles)) {
      throw new UnprocessableEntityException("The role package schema is incompatible");
    }
    if (input.roles.length > MAX_ROLES) throw new UnprocessableEntityException("The role package contains too many roles");
    let versionCount = 0;
    const roleIds = new Set<string>();
    const versionIds = new Set<string>();
    const roles = input.roles.map((candidate): PortableRole => {
      if (!record(candidate) || !exactKeys(candidate, ["currentVersionId", "id", "versions"]) ||
          typeof candidate.id !== "string" || !UUID.test(candidate.id) ||
          typeof candidate.currentVersionId !== "string" || !UUID.test(candidate.currentVersionId) ||
          !Array.isArray(candidate.versions) || !candidate.versions.length) {
        throw new UnprocessableEntityException("A portable role definition is invalid");
      }
      if (roleIds.has(candidate.id)) throw new UnprocessableEntityException("Stable role identities must be unique");
      roleIds.add(candidate.id);
      const versions = candidate.versions.map((version, index): PortableVersion => {
        versionCount += 1;
        if (!record(version) || !exactKeys(version,
          ["capabilityKeys", "description", "displayName", "id", "version"]) ||
            typeof version.id !== "string" || !UUID.test(version.id) || versionIds.has(version.id) ||
            version.version !== index + 1 || typeof version.displayName !== "string" ||
            !Array.isArray(version.capabilityKeys) || !version.capabilityKeys.length ||
            version.capabilityKeys.some((key) => typeof key !== "string") ||
            (version.description !== null && typeof version.description !== "string")) {
          throw new UnprocessableEntityException("Immutable role history is malformed");
        }
        versionIds.add(version.id);
        const displayName = normalizeRoleName(version.displayName);
        const description = version.description?.normalize("NFC").trim() || null;
        if (displayName !== version.displayName || !displayName || displayName.length > 100 ||
            /[\p{Cc}\p{Cf}]/u.test(displayName) || (description !== version.description) ||
            Boolean(description && (description.length > 500 || /[\p{Cc}\p{Cf}]/u.test(description)))) {
          throw new UnprocessableEntityException("Role presentation is not normalized or exceeds its limits");
        }
        if (new Set(version.capabilityKeys).size !== version.capabilityKeys.length) {
          throw new UnprocessableEntityException("Each capability may appear only once in a role version");
        }
        return { id: version.id, version: version.version, displayName, description,
          capabilityKeys: [...version.capabilityKeys].sort() };
      });
      if (versions.at(-1)?.id !== candidate.currentVersionId) {
        throw new UnprocessableEntityException("The current role version must be the newest history entry");
      }
      return { id: candidate.id, currentVersionId: candidate.currentVersionId, versions };
    });
    if (versionCount > MAX_VERSIONS) throw new UnprocessableEntityException("The role package contains too many versions");
    return { schema: SCHEMA, schemaVersion: SCHEMA_VERSION, roles: roles.sort((a, b) => a.id.localeCompare(b.id)) };
  }

  private assertHistory(portable: PortableCustomRolePackage, existing: Map<string, ExistingVersionRow[]>): void {
    for (const role of portable.roles) {
      const prior = existing.get(role.id) ?? [];
      if (prior.length > role.versions.length) throw new ConflictException("Stable role history has diverged");
      for (let index = 0; index < prior.length; index += 1) {
        const stored = prior[index]!;
        const supplied = role.versions[index]!;
        if (Number(stored.version) !== supplied.version || stored.id !== supplied.id ||
            stored.display_name !== supplied.displayName || stored.description !== supplied.description ||
            JSON.stringify(this.textArray(stored.capability_keys)) !== JSON.stringify(supplied.capabilityKeys)) {
          throw new ConflictException("Stable role history has diverged");
        }
      }
    }
  }

  private async assertVersionIdsAvailable(manager: EntityManager, portable: PortableCustomRolePackage): Promise<void> {
    const ids = portable.roles.flatMap(({ versions }) => versions.map(({ id }) => id));
    if (!ids.length) return;
    const allowed = new Map(portable.roles.flatMap((role) => role.versions.map((version) => [version.id, role.id])));
    const collisions = await manager.query<Array<{ id: string; role_id: string }>>(`
      select id, role_id from app_identity.role_version where id = any($1::uuid[])
    `, [ids]);
    if (collisions.some((row) => allowed.get(row.id) !== row.role_id)) {
      throw new ConflictException("Stable role-version history has diverged");
    }
  }

  private async catalog(manager: EntityManager, keys: string[]): Promise<Map<string, CapabilityRow[]>> {
    if (!keys.length) return new Map();
    const rows = await manager.query<CapabilityRow[]>(`
      select capability.key, capability.system_only, required.prerequisite_key
      from app_identity.capability capability left join app_identity.capability_prerequisite required
        on required.capability_key = capability.key where capability.key = any($1::text[])
      order by capability.key, required.prerequisite_key
    `, [keys]);
    const result = new Map<string, CapabilityRow[]>();
    for (const row of rows) result.set(row.key, [...(result.get(row.key) ?? []), row]);
    return result;
  }

  private assertCapabilities(portable: PortableCustomRolePackage, catalog: Map<string, CapabilityRow[]>): void {
    for (const role of portable.roles) for (const version of role.versions) {
      const selected = new Set(version.capabilityKeys);
      for (const key of selected) {
        const definitions = catalog.get(key);
        if (!definitions || definitions.some(({ system_only }) => system_only)) {
          throw new UnprocessableEntityException("The package contains a system-only or unregistered capability");
        }
        const missing = definitions.flatMap(({ prerequisite_key }) => prerequisite_key && !selected.has(prerequisite_key)
          ? [`${key} requires ${prerequisite_key}`] : []);
        if (missing.length) throw new UnprocessableEntityException({
          message: "Capability prerequisites are missing", findings: missing
        });
      }
    }
  }

  private async assertCeiling(manager: EntityManager, session: ClinicianSession, keys: string[]): Promise<void> {
    const owners = await manager.query<Array<{ owner: boolean }>>(`select exists (
      select 1 from app_identity.installation_owner where organization_id = $1 and user_id = $2
    ) owner`, [session.organization.id, session.user.id]);
    if (!owners[0]?.owner && keys.some((key) => !session.capabilities?.includes(key))) {
      throw new ForbiddenException("The package exceeds your current capability ceiling");
    }
  }

  private async assertNamesAvailable(manager: EntityManager, organizationId: string,
    portable: PortableCustomRolePackage): Promise<void> {
    const identities = portable.roles.map((role) => ({ id: role.id,
      name: role.versions.find(({ id }) => id === role.currentVersionId)!.displayName }));
    const folded = identities.map(({ name }) => name.toLocaleLowerCase());
    if (new Set(folded).size !== folded.length) throw new ConflictException("Imported active role names must be unique");
    if (!identities.length) return;
    const rows = await manager.query<Array<{ id: string; protected: boolean }>>(`
      select id, protected from app_identity.role
      where organization_id = $1 and lower(display_name) = any($2::text[]) and (active or protected)
        and not (id = any($3::uuid[]))
    `, [organizationId, folded, identities.map(({ id }) => id)]);
    if (rows.some((row) => row.protected)) throw new ForbiddenException("Protected role identities cannot be imported");
    if (rows.length) throw new ConflictException("An active role already uses an imported name");
  }

  private async activate(manager: EntityManager, session: ClinicianSession, role: PortableRole,
    existing?: ExistingRoleRow): Promise<void> {
    const current = role.versions.find(({ id }) => id === role.currentVersionId)!;
    if (!existing) {
      await manager.query(`insert into app_identity.role
        (id, organization_id, display_name, description, current_version_id, created_by, note)
        values ($1, $2, $3, $4, $5, $6, 'Portable role import')`,
      [role.id, session.organization.id, current.displayName, current.description, current.id, session.user.id]);
    }
    const priorCount = existing ? (await manager.query<Array<{ count: number | string }>>(`
      select count(*) count from app_identity.role_version where organization_id = $1 and role_id = $2
    `, [session.organization.id, role.id]))[0]?.count : 0;
    for (const version of role.versions.slice(Number(priorCount ?? 0))) {
      await manager.query(`insert into app_identity.role_version
        (id, organization_id, role_id, version, display_name, description, created_by, note)
        values ($1, $2, $3, $4, $5, $6, $7, 'Portable role import')`,
      [version.id, session.organization.id, role.id, version.version, version.displayName,
        version.description, session.user.id]);
      await manager.query(`insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key)
        select $1, $2, $3, key from unnest($4::text[]) key`,
      [session.organization.id, version.id, role.id, version.capabilityKeys]);
    }
    if (existing && (existing.current_version_id !== current.id || !existing.active)) {
      const updated = await manager.query<Array<{ id: string }>>(`update app_identity.role
        set display_name = $3, description = $4, current_version_id = $5, active = true,
          assignable = true, note = 'Portable role import'
        where organization_id = $1 and id = $2 and current_version_id = $6 returning id`,
      [session.organization.id, role.id, current.displayName, current.description, current.id,
        existing.current_version_id]);
      if (!updated[0]) throw new ConflictException("The role changed during import");
    }
  }

  private currentCapabilities(role: ExistingRoleRow | undefined,
    versions: ExistingVersionRow[] | undefined): Set<string> {
    if (!role) return new Set();
    return new Set(this.textArray(versions?.find(({ id }) => id === role.current_version_id)?.capability_keys ?? null));
  }

  private portableVersion(row: ExistingVersionRow): PortableVersion {
    return { id: row.id, version: Number(row.version), displayName: row.display_name,
      description: row.description, capabilityKeys: this.textArray(row.capability_keys) };
  }

  private textArray(value: string[] | string | null): string[] {
    if (Array.isArray(value)) return value;
    if (!value || value === "{}") return [];
    return value.slice(1, -1).split(",").filter(Boolean);
  }

  private digest(portable: PortableCustomRolePackage): string {
    return createHash("sha256").update(JSON.stringify(portable)).digest("hex");
  }

  private audit(manager: EntityManager, session: ClinicianSession, action: string, digest: string,
    details: Record<string, number>): Promise<unknown> {
    return manager.query(`insert into app_identity.authorization_event
      (organization_id, actor_id, action, target_type, target_key, details)
      values ($1, $2, $3, 'role_package', $4, $5::jsonb)`,
    [session.organization.id, session.user.id, action, digest, JSON.stringify({ packageDigest: digest, ...details })]);
  }
}
