import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { SYNTHETIC_DEMO_FIXTURE, type AgencySummary } from "@open-triage/contracts";
import { agencyRequest } from "./agency-context.js";

export type AgencyRow = { id: string; name: string; parent_organization_id: string | null;
  hostname: string | null; active: boolean; revision: string | number; deployment_timezone: string;
  shift_session_duration_hours: number };
export const agencySummary = (row: AgencyRow): AgencySummary => ({ id: row.id, name: row.name,
  parentOrganizationId: row.parent_organization_id, groupId: row.parent_organization_id ?? row.id,
  hostname: row.hostname, active: row.active, revision: Number(row.revision), timeZone: row.deployment_timezone });

@Injectable()
export class AgencyDirectoryService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  private async registeredAgency(hostname: string, manager: Pick<EntityManager, "query"> = this.database.manager) {
    // The existing fictional fixture has a local address without changing its hosted configuration.
    const demoId = process.env.NODE_ENV !== "production" && hostname === "demo.localhost"
      ? SYNTHETIC_DEMO_FIXTURE.organizationId : null;
    const rows = await manager.query<Array<AgencyRow & { root_active: boolean }>>(`select agency.*, root.active root_active from app_identity.organization agency
      join app_identity.organization root on root.id = coalesce(agency.parent_organization_id, agency.id)
      where agency.hostname = $1 or (agency.id = $2 and agency.hostname is null)
      order by (agency.hostname = $1) desc nulls last limit 1`, [hostname, demoId]);
    return rows[0];
  }

  async forLogin(manager: Pick<EntityManager, "query"> = this.database.manager): Promise<AgencyRow | null> {
    const origin = agencyRequest.getStore()?.origin;
    if (!origin) return null; // Internal callers select the account's home agency.
    const url = new URL(origin);
    const agency = await this.registeredAgency(url.hostname, manager);
    if (agency?.active && agency.root_active) return agency;
    if (agency) throw new NotFoundException("No active agency is configured for this address");
    const portal = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (origin === portal.toLowerCase() || process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    throw new NotFoundException("No active agency is configured for this address");
  }

  async accessible(userId: string, manager: Pick<EntityManager, "query"> = this.database.manager): Promise<AgencySummary[]> {
    const rows = await manager.query<AgencyRow[]>(`select agency.* from app_identity.organization agency
      where app_identity.user_can_access_organization($1, agency.id)
      order by coalesce(agency.parent_organization_id, agency.id), agency.parent_organization_id nulls first, agency.name, agency.id`, [userId]);
    return rows.map(agencySummary);
  }

  async allowsOrigin(origin: string): Promise<boolean> {
    let url: URL;
    try { url = new URL(origin); } catch { return false; }
    if (origin === (process.env.WEB_ORIGIN ?? "http://localhost:3000")) return true;
    const portal = new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000");
    const localDevelopment = process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.localhost$/.test(url.hostname) && url.port === portal.port;
    if (url.origin !== origin || (!localDevelopment && (url.protocol !== "https:" || url.port))) return false;
    const agency = await this.registeredAgency(url.hostname);
    return agency?.active === true && agency.root_active === true;
  }
}
