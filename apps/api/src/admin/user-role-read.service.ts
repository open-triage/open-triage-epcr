import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type {
  AdminAssignableRoleSummary, AdminCapabilityDefinition, AdminRole, AdminRoleList, AdminRoleSummary, AdminRoleSummaryList, AdminUserPage, AdminExternalIdentitySummary
} from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type UserState = "active" | "disabled" | "all" | "pending" | "denied";
type UserCursor = {
  active: boolean;
  displayName: string;
  id: string;
  state: UserState;
  search: string;
  roleId: string | null;
  kind?: "user" | "external";
};
type UserRow = {
  id: string; display_name: string; username: string | null; active: boolean; revision: string | number;
  owner: boolean; superadmin: boolean;
  roles: AdminRoleSummary[] | string | null;
  kind?: "user" | "external";
  regional_identity?: AdminExternalIdentitySummary | null;
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

function state(value: unknown, fallback: UserState = "active", review = false): UserState {
  const selected = one(value) ?? fallback;
  if (selected !== "active" && selected !== "disabled" && selected !== "all" && !(review && ["pending", "denied"].includes(selected))) {
    throw new BadRequestException("state must be active, disabled, or all");
  }
  return selected as UserState;
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
        parsed.kind !== undefined && !["user", "external"].includes(parsed.kind) ||
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
    const selectedState = state(input.state, "active", true);
    const search = (one(input.search) ?? "").trim().normalize("NFC").toLocaleLowerCase("en-US").slice(0, 100);
    const roleId = one(input.roleId) ?? null;
    if (roleId && !UUID.test(roleId)) throw new BadRequestException("roleId must be a UUID");
    const requestedLimit = Number(one(input.limit) ?? DEFAULT_PAGE_SIZE);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new BadRequestException("limit must be a positive integer");
    const pageSize = Math.min(requestedLimit, MAX_PAGE_SIZE);
    const cursor = decodeCursor(one(input.cursor), { state: selectedState, search, roleId });
    const rows = await this.dataSource.query<UserRow[]>(`
      with directory as (select u.id, u.display_name, credential.username, u.active, u.revision,
        exists (select 1 from app_identity.installation_superadmin where user_id=u.id) superadmin,
        exists (select 1 from app_identity.installation_owner installation_owner
          where installation_owner.user_id = u.id) as owner,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', role.id, 'displayName', role.display_name,
            'active', role.active, 'protected', role.protected
          ) order by lower(role.display_name), role.id)
          from app_identity.user_role_assignment assignment
          join app_identity.role role
            on role.organization_id = assignment.organization_id and role.id = assignment.role_id
          where assignment.organization_id = $1 and assignment.user_id = u.id
            and assignment.ended_at is null and not role.hidden
        ), '[]'::jsonb) as roles, 'user'::text kind, null::jsonb regional_identity
      from app_identity.app_user u
      left join app_identity.local_credential credential on credential.user_id = u.id
      where app_identity.organization_group(u.organization_id) = app_identity.organization_group($1)
      union all
      select r.id, normalize(coalesce(r.display_name,r.subject),NFC), null, false, r.review_revision,
        false,false,'[]'::jsonb,'external',jsonb_build_object(
          'id',r.id,'providerId',r.provider_id,'revision',r.first_revision,'reviewRevision',r.review_revision,
          'issuer',r.issuer,'subject',r.subject,'displayName',r.display_name,'email',r.email,'createdAt',r.created_at,
          'status',case when r.denied_at is null then 'pending' else 'denied' end,
          'linkedUserId',null,'deniedAt',r.denied_at,'reviewProviders',coalesce((
            select jsonb_agg(jsonb_build_object('source',p.source,'revision',v.revision))
            from app_identity.oidc_provider_state s
            cross join lateral (values ('draft',s.draft_revision),('active',s.active_revision)) p(source,revision)
            join app_identity.oidc_provider_version v on v.group_id=s.group_id and v.revision=p.revision
            where s.group_id=r.group_id and v.provider_id=r.provider_id and v.configuration->>'issuer'=r.issuer
          ),'[]'::jsonb))
      from app_identity.regional_identity_request r
      where $10::boolean and r.group_id=app_identity.organization_group($1) and r.linked_user_id is null)
      select u.* from directory u
      where ($2 = 'all' or (u.kind='user' and $2 in ('active','disabled') and u.active=($2='active'))
        or (u.kind='external' and u.regional_identity->>'status'=$2))
        and ($3 = '' or lower(u.display_name) like $4 escape '\\' or lower(u.username) like $4 escape '\\'
          or lower(u.regional_identity->>'email') like $4 escape '\\' or lower(u.regional_identity->>'subject') like $4 escape '\\')
        and ($5::uuid is null or (u.kind='user' and exists (
          select 1 from app_identity.user_role_assignment role_filter
          where role_filter.organization_id = $1 and role_filter.user_id = u.id
            and role_filter.role_id = $5 and role_filter.ended_at is null
        )))
        and ($6::boolean is null or (not u.active, lower(u.display_name), u.id,u.kind) >
          (not $6::boolean, $7, $8::uuid,$11::text))
      order by not u.active, lower(u.display_name), u.id,u.kind
      limit $9
    `, [session.organization.id, selectedState, search, literalLike(search), roleId,
      cursor?.active ?? null, cursor?.displayName ?? "", cursor?.id ?? null, pageSize + 1,
      session.capabilities?.includes("settings:read") ?? false,cursor?.kind??"user"]);
    const visible = rows.slice(0, pageSize);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => ({ id: row.id, displayName: row.display_name, username: row.username,
        active: row.active, revision: Number(row.revision), owner: row.owner, superadmin: row.superadmin,
        roles: parsedJsonArray(row.roles),...(row.regional_identity?{externalIdentity:row.regional_identity}:{}) })),
      pageSize,
      nextCursor: rows.length > pageSize && last ? encodeCursor({ active: last.active,
        displayName: last.display_name.normalize("NFC").toLocaleLowerCase("en-US"), id: last.id,
        state: selectedState, search, roleId,kind:last.kind??"user" }) : null
    };
  }

  async userRoleOptions(token: string): Promise<AdminRoleSummaryList> {
    const session = await this.sessions.requireCapability(token, "users:read");
    const rows = await this.dataSource.query<Array<{
      id: string; display_name: string; active: boolean; protected: boolean;
      assignment_restricted: boolean; assignment_mutable: boolean;
    }>>(`select role.id, role.display_name, role.active, role.protected,
        role.system_key in ('administrator', 'demo') assignment_restricted,
        (app_identity.is_installation_superadmin($2) and app_identity.user_can_access_organization($2, $1))
        or ((role.system_key is null or role.system_key not in ('administrator', 'demo'))
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
