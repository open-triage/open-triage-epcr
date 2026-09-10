import { randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ClinicianSession, CreateClinicianSessionCommand } from "@open-triage/contracts";
import { DataSource } from "typeorm";

export const DEMO_CLINICIAN_USERNAME = "demo.clinician";
export const DEMO_CLINICIAN_PASSWORD = "open-triage-demo";

type DemoClinicianRow = {
  user_id: string;
  display_name: string;
  organization_id: string;
  organization_name: string;
  shift_session_duration_hours: number;
};

type StoredSession = ClinicianSession & { revoked: boolean };

function matchesCredential(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

@Injectable()
export class ClinicianSessionService {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(command: CreateClinicianSessionCommand, now = new Date()): Promise<ClinicianSession> {
    this.pruneExpired(now);

    if (!matchesCredential(command.username, DEMO_CLINICIAN_USERNAME) ||
        !matchesCredential(command.password, DEMO_CLINICIAN_PASSWORD)) {
      throw new UnauthorizedException("The username or password is incorrect");
    }

    const rows = await this.dataSource.query<DemoClinicianRow[]>(`
      select u.id as user_id, u.display_name, o.id as organization_id,
             o.name as organization_name, o.shift_session_duration_hours
      from app_identity.external_identity ei
      join app_identity.app_user u on u.id = ei.user_id
      join app_identity.organization o on o.id = u.organization_id
      where ei.provider = 'synthetic-bootstrap' and ei.subject = 'clinician'
        and u.active and u.synthetic
      limit 1
    `);
    const clinician = rows[0];
    if (!clinician) throw new UnauthorizedException("The demo clinician is unavailable");

    const accessToken = randomBytes(32).toString("base64url");
    const startedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + clinician.shift_session_duration_hours * 60 * 60 * 1_000).toISOString();
    const session: StoredSession = {
      accessToken,
      user: { id: clinician.user_id, displayName: clinician.display_name },
      organization: { id: clinician.organization_id, name: clinician.organization_name },
      startedAt,
      expiresAt,
      revoked: false
    };
    this.sessions.set(accessToken, session);
    return this.publicSession(session);
  }

  get(accessToken: string, now = new Date()): ClinicianSession {
    const session = this.sessions.get(accessToken);
    if (!session || session.revoked || Date.parse(session.expiresAt) <= now.getTime()) {
      if (session) this.sessions.delete(accessToken);
      throw new UnauthorizedException("The clinician session has ended");
    }
    return this.publicSession(session);
  }

  end(accessToken: string): void {
    const session = this.sessions.get(accessToken);
    if (!session || session.revoked) throw new UnauthorizedException("The clinician session has ended");
    session.revoked = true;
    this.sessions.delete(accessToken);
  }

  private publicSession(session: StoredSession): ClinicianSession {
    const { revoked: _revoked, ...result } = session;
    return result;
  }

  /**
   * The session map has no background sweep, so expired sessions would otherwise
   * accumulate indefinitely until individually looked up. Piggyback a prune on every
   * `create()` call instead of standing up timer-based infrastructure for it.
   */
  private pruneExpired(now: Date): void {
    const nowMs = now.getTime();
    for (const [accessToken, session] of this.sessions) {
      if (session.revoked || Date.parse(session.expiresAt) <= nowMs) {
        this.sessions.delete(accessToken);
      }
    }
  }
}
