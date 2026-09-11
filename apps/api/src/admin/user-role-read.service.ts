import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  AdminAssignableRoleSummary, AdminCapabilityDefinition, AdminRole, AdminRoleList, AdminRoleSummary, AdminRoleSummaryList, AdminUserPage
} from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type UserState = "active" | "disabled" | "all";
type UserCursor = {
  active: boolean;
  displayName: string;
  id: string;
  state: UserState;
  search: string;
  roleId: string | null;
};
type UserRow = {
  id: string; display_name: string; username: string; active: boolean; revision: string | number;
  roles: AdminRoleSummary[] | string | null;
};
type RoleRow = {
  id: string; display_name: string; description: string | null; active: boolean; protected: boolean;
  version: string | number; assignee_count: string | number;
  capabilities: AdminCapabilityDefinition[] | string | null;
};

function one(value: unknown): string | undefined {
  return Array.isArray(value) ? (typeof value[0] === "string" ? value[0] : undefined)
    : typeof value === "string" ? value : undefined;
}

function state(value: unknown, fallback: UserState = "active"): UserState {
  const selected = one(value) ?? fallback;
  if (selected !== "active" && selected !== "disabled" && selected !== "all") {
    throw new BadRequestException("state must be active, disabled, or all");
  }
  return selected;
}

function parsedJsonArray<T>(value: T[] | string | null): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function encodeCursor(cursor: UserCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined, expected: Omit<UserCursor, "active" | "displayName" | "id">): UserCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<UserCursor>;
    if (typeof parsed.active !== "boolean" || typeof parsed.displayName !== "string" || !UUID.test(parsed.id ?? "") ||
        parsed.state !== expected.state || parsed.search !== expected.search || parsed.roleId !== expected.roleId) throw new Error();
    return parsed as UserCursor;
  } catch {
    throw new BadRequestException("cursor is invalid for this user query");
  }
}

function literalLike(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

@Injectable()
export class UserRoleReadService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async users(token: string, input: Record<string, unknown>): Promise<AdminUserPage> {
    const session = await this.sessions.requireCapability(token, "users:read");
    const selectedState = state(input.state);
    const search = (one(input.search) ?? "").trim().normalize("NFC").toLocaleLowerCase("en-US").slice(0, 100);
    const roleId = one(input.roleId) ?? null;
    if (roleId && !UUID.test(roleId)) throw new BadRequestException("roleId must be a UUID");
    const requestedLimit = Number(one(input.limit) ?? DEFAULT_PAGE_SIZE);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new BadRequestException("limit must be a positive integer");
    const pageSize = Math.min(requestedLimit, MAX_PAGE_SIZE);
    const cursor = decodeCursor(one(input.cursor), { state: selectedState, search, roleId });
    const rows = await this.dataSource.query<UserRow[]>(`
      select u.id, u.display_name, credential.username, u.active, u.revision,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', role.id, 'displayName', role.display_name,
            'active', role.active, 'protected', role.protected
          ) order by lower(role.display_name), role.id)
          from app_identity.user_role_assignment assignment
          join app_identity.role role
            on role.organization_id = assignment.organization_id and role.id = assignment.role_id
          where assignment.organization_id = u.organization_id and assignment.user_id = u.id
            and assignment.ended_at is null and not role.hidden
        ), '[]'::jsonb) as roles
      from app_identity.app_user u
      join app_identity.local_credential credential on credential.user_id = u.id
      where u.organization_id = $1
        and ($2 = 'all' or u.active = ($2 = 'active'))
        and ($3 = '' or lower(u.display_name) like $4 escape '\\' or credential.username like $4 escape '\\')
        and ($5::uuid is null or exists (
          select 1 from app_identity.user_role_assignment role_filter
          where role_filter.organization_id = u.organization_id and role_filter.user_id = u.id
            and role_filter.role_id = $5 and role_filter.ended_at is null
        ))
        and ($6::boolean is null or (not u.active, lower(u.display_name), u.id) >
          (not $6::boolean, $7, $8::uuid))
      order by not u.active, lower(u.display_name), u.id
      limit $9
    `, [session.organization.id, selectedState, search, literalLike(search), roleId,
      cursor?.active ?? null, cursor?.displayName ?? "", cursor?.id ?? null, pageSize + 1]);
    const visible = rows.slice(0, pageSize);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => ({ id: row.id, displayName: row.display_name, username: row.username,
        active: row.active, revision: Number(row.revision), roles: parsedJsonArray(row.roles) })),
      pageSize,
      nextCursor: rows.length > pageSize && last ? encodeCursor({ active: last.active,
        displayName: last.display_name.normalize("NFC").toLocaleLowerCase("en-US"), id: last.id,
        state: selectedState, search, roleId }) : null
    };
  }

  async userRoleOptions(token: string): Promise<AdminRoleSummaryList> {
    const session = await this.sessions.requireCapability(token, "users:read");
    const rows = await this.dataSource.query<Array<{
      id: string; display_name: string; active: boolean; protected: boolean;
      assignment_restricted: boolean; assignment_mutable: boolean;
    }>>(`select role.id, role.display_name, role.active, role.protected,
        role.system_key in ('administrator', 'clinical-demo') assignment_restricted,
        exists (select 1 from app_identity.installation_owner
          where organization_id = $1 and user_id = $2)
        or ((role.system_key is null or role.system_key not in ('administrator', 'clinical-demo'))
          and not exists (
            select 1 from app_identity.role_version_capability definition
            where definition.role_version_id = role.current_version_id
              and not (definition.capability_key = any($3::text[]))
          )) assignment_mutable
      from app_identity.role role
      where role.organization_id = $1 and not role.hidden
      order by not role.active, lower(role.display_name), role.id`,
    [session.organization.id, session.user.id, session.capabilities ?? []]);
    return { items: rows.map((row): AdminAssignableRoleSummary => ({ id: row.id, displayName: row.display_name,
      active: row.active, protected: row.protected, assignmentRestricted: row.assignment_restricted,
      assignmentMutable: row.assignment_mutable })) };
  }

  async roles(token: string, input: Record<string, unknown>): Promise<AdminRoleList> {
    const session = await this.sessions.requireCapability(token, "roles:read");
    const selectedState = state(input.state);
    const rows = await this.dataSource.query<RoleRow[]>(`
      select role.id, role.display_name, role.description, role.active, role.protected,
        version.version,
        count(distinct assignment.user_id) as assignee_count,
        coalesce(jsonb_agg(distinct jsonb_build_object(
          'key', capability.key, 'description', capability.description,
          'administrative', capability.administrative, 'systemOnly', capability.system_only
        )) filter (where capability.key is not null), '[]'::jsonb) as capabilities
      from app_identity.role role
      join app_identity.role_version version
        on version.organization_id = role.organization_id and version.role_id = role.id
        and version.id = role.current_version_id
      left join app_identity.role_version_capability definition
        on definition.organization_id = version.organization_id and definition.role_id = version.role_id
        and definition.role_version_id = version.id
      left join app_identity.capability capability on capability.key = definition.capability_key
      left join app_identity.user_role_assignment assignment
        on assignment.organization_id = role.organization_id and assignment.role_id = role.id
        and assignment.ended_at is null
      where role.organization_id = $1 and not role.hidden
        and ($2 = 'all' or role.active = ($2 = 'active'))
      group by role.id, version.id, version.version
      order by not role.active, lower(role.display_name), role.id
    `, [session.organization.id, selectedState]);
    return { items: rows.map((row): AdminRole => ({
      id: row.id, displayName: row.display_name, description: row.description,
      active: row.active, protected: row.protected, version: Number(row.version),
      assigneeCount: Number(row.assignee_count),
      capabilities: parsedJsonArray(row.capabilities).sort((left, right) => left.key.localeCompare(right.key))
    })) };
  }
}
