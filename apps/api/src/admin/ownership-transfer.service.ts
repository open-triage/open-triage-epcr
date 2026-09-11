import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { CancelOwnershipTransferCommand, InitiateOwnershipTransferCommand,
  OwnershipTransferState, OwnershipTransferSummary } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type OwnerRow = { user_id: string; display_name: string };
type TransferRow = {
  id: string; status: OwnershipTransferSummary["status"]; initiated_at: Date | string; expires_at: Date | string;
  resolved_at: Date | string | null; resolution_reason: string | null; nominated_by: string;
  nominated_by_name: string; nominee_user_id: string; nominee_name: string;
};
type Failure = "not_owner" | "not_nominee" | "stale" | "conflict" | "ineligible";
type Outcome<T> = { value: T; failure?: never } | { failure: Failure; value?: never };

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

@Injectable()
export class OwnershipTransferService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async state(token: string, now = new Date()): Promise<OwnershipTransferState> {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "users:read", manager, now);
      return this.readState(manager, actor.organization.id, actor.user.id, now);
    });
  }

  async initiate(token: string, command: InitiateOwnershipTransferCommand,
    now = new Date()): Promise<OwnershipTransferState> {
    const outcome = await this.dataSource.transaction<Outcome<OwnershipTransferState>>(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "users:read", manager, now);
      const owner = await this.lockOwner(manager, actor.organization.id);
      await this.settle(manager, actor.organization.id, now);
      if (owner.user_id !== actor.user.id) {
        await this.audit(manager, actor.organization.id, null, actor.user.id, "owner.transfer.conflict", "failed",
          { reason: "current_owner_required" });
        return { failure: "not_owner" };
      }
      try {
        await this.sessions.requireRecentReauthentication(token, manager, now);
      } catch {
        await this.audit(manager, actor.organization.id, null, actor.user.id,
          "owner.transfer.stale_assurance", "failed", { operation: "initiate" });
        return { failure: "stale" };
      }
      const pending = await this.pending(manager, actor.organization.id);
      if (pending) {
        await this.audit(manager, actor.organization.id, pending.id, actor.user.id,
          "owner.transfer.conflict", "failed", { reason: "transfer_already_pending" });
        return { failure: "conflict" };
      }
      const eligible = await this.eligible(manager, actor.organization.id, command.nomineeUserId, true);
      if (!eligible || eligible.user_id === owner.user_id) {
        await this.audit(manager, actor.organization.id, null, actor.user.id,
          "owner.transfer.ineligible", "failed", { nomineeUserId: command.nomineeUserId });
        return { failure: "ineligible" };
      }
      const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1_000);
      const inserted = await manager.query<Array<{ id: string }>>(`insert into app_identity.ownership_transfer
        (organization_id, nominated_by, nominee_user_id, initiated_at, expires_at, note)
        values ($1, $2, $3, $4, $5, $6) returning id`,
      [actor.organization.id, actor.user.id, command.nomineeUserId, now, expiresAt, command.note ?? null]);
      await this.audit(manager, actor.organization.id, inserted[0]!.id, actor.user.id,
        "owner.transfer.initiate", "succeeded", { nomineeUserId: command.nomineeUserId, expiresAt: expiresAt.toISOString() }, command.note);
      return { value: await this.readState(manager, actor.organization.id, actor.user.id, now, false) };
    });
    return this.unwrap(outcome);
  }

  async accept(token: string, now = new Date()): Promise<OwnershipTransferState> {
    const outcome = await this.dataSource.transaction<Outcome<OwnershipTransferState>>(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "users:read", manager, now);
      const owner = await this.lockOwner(manager, actor.organization.id);
      await this.settle(manager, actor.organization.id, now);
      const transfer = await this.pending(manager, actor.organization.id);
      if (!transfer) {
        await this.audit(manager, actor.organization.id, null, actor.user.id,
          "owner.transfer.conflict", "failed", { reason: "no_pending_transfer", operation: "accept" });
        return { failure: "conflict" };
      }
      if (transfer.nominee_user_id !== actor.user.id) {
        await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
          "owner.transfer.conflict", "failed", { reason: "nominee_required", operation: "accept" });
        return { failure: "not_nominee" };
      }
      try {
        await this.sessions.requireRecentReauthentication(token, manager, now);
      } catch {
        await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
          "owner.transfer.stale_assurance", "failed", { operation: "accept" });
        return { failure: "stale" };
      }
      if (!await this.eligible(manager, actor.organization.id, actor.user.id, true)) {
        await manager.query(`update app_identity.ownership_transfer set status = 'ineligible', resolved_at = $2,
          resolved_by = $3, resolution_reason = 'nominee_not_active_administrator' where id = $1 and status = 'pending'`,
        [transfer.id, now, actor.user.id]);
        await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
          "owner.transfer.ineligible", "succeeded", { reason: "nominee_not_active_administrator" });
        return { failure: "ineligible" };
      }
      await manager.query(`update app_identity.installation_owner
        set user_id = $2, established_at = $3, established_by_operator_id = 'accepted-owner-nomination'
        where organization_id = $1 and user_id = $4`,
      [actor.organization.id, actor.user.id, now, owner.user_id]);
      await manager.query(`update app_identity.ownership_transfer set status = 'accepted', resolved_at = $2,
        resolved_by = $3, resolution_reason = 'nominee_accepted' where id = $1 and status = 'pending'`,
      [transfer.id, now, actor.user.id]);
      await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
        "owner.transfer.accept", "succeeded", { formerOwnerUserId: owner.user_id, newOwnerUserId: actor.user.id });
      return { value: await this.readState(manager, actor.organization.id, actor.user.id, now, false) };
    });
    return this.unwrap(outcome);
  }

  async cancel(token: string, command: CancelOwnershipTransferCommand,
    now = new Date()): Promise<OwnershipTransferState> {
    const outcome = await this.dataSource.transaction<Outcome<OwnershipTransferState>>(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "users:read", manager, now);
      const owner = await this.lockOwner(manager, actor.organization.id);
      await this.settle(manager, actor.organization.id, now);
      const transfer = await this.pending(manager, actor.organization.id);
      if (!transfer) {
        await this.audit(manager, actor.organization.id, null, actor.user.id,
          "owner.transfer.conflict", "failed", { reason: "no_pending_transfer", operation: "cancel" }, command.note);
        return { failure: "conflict" };
      }
      if (actor.user.id !== owner.user_id && actor.user.id !== transfer.nominee_user_id) {
        await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
          "owner.transfer.conflict", "failed", { reason: "transfer_party_required", operation: "cancel" }, command.note);
        return { failure: "not_nominee" };
      }
      await manager.query(`update app_identity.ownership_transfer set status = 'cancelled', resolved_at = $2,
        resolved_by = $3, resolution_reason = 'cancelled_by_party' where id = $1 and status = 'pending'`,
      [transfer.id, now, actor.user.id]);
      await this.audit(manager, actor.organization.id, transfer.id, actor.user.id,
        "owner.transfer.cancel", "succeeded", { cancelledBy: actor.user.id }, command.note);
      return { value: await this.readState(manager, actor.organization.id, actor.user.id, now, false) };
    });
    return this.unwrap(outcome);
  }

  private async readState(manager: EntityManager, organizationId: string, actorId: string, now: Date,
    settle = true): Promise<OwnershipTransferState> {
    const owner = await this.lockOwner(manager, organizationId);
    if (settle) await this.settle(manager, organizationId, now);
    const rows = await manager.query<TransferRow[]>(`${this.transferSelect()}
      where transfer.organization_id = $1 order by transfer.initiated_at desc, transfer.id desc limit 1`, [organizationId]);
    const transfer = rows[0] ? this.summary(rows[0]) : null;
    const nominees = owner.user_id === actorId ? await manager.query<Array<{ user_id: string; display_name: string }>>(`
      select distinct u.id user_id, u.display_name
      from app_identity.app_user u
      join app_identity.user_role_assignment assignment on assignment.organization_id = u.organization_id
        and assignment.user_id = u.id and assignment.ended_at is null
      join app_identity.role role on role.organization_id = assignment.organization_id and role.id = assignment.role_id
      where u.organization_id = $1 and u.active and u.id <> $2 and role.system_key = 'administrator'
        and role.active and role.assignable order by u.display_name, u.id`, [organizationId, owner.user_id]) : [];
    return { owner: { id: owner.user_id, displayName: owner.display_name }, currentUserIsOwner: owner.user_id === actorId,
      currentUserIsNominee: transfer?.status === "pending" && transfer.nominee.id === actorId,
      transfer, eligibleNominees: nominees.map((row) => ({ id: row.user_id, displayName: row.display_name })) };
  }

  private async settle(manager: EntityManager, organizationId: string, now: Date): Promise<void> {
    const pending = await this.pending(manager, organizationId);
    if (!pending) return;
    if (new Date(pending.expires_at).getTime() <= now.getTime()) {
      await manager.query(`update app_identity.ownership_transfer set status = 'expired', resolved_at = $2,
        resolution_reason = 'seventy_two_hours_elapsed' where id = $1 and status = 'pending'`, [pending.id, now]);
      await this.audit(manager, organizationId, pending.id, null, "owner.transfer.expire", "succeeded",
        { nomineeUserId: pending.nominee_user_id });
      return;
    }
    if (!await this.eligible(manager, organizationId, pending.nominee_user_id, false)) {
      await manager.query(`update app_identity.ownership_transfer set status = 'ineligible', resolved_at = $2,
        resolution_reason = 'nominee_not_active_administrator' where id = $1 and status = 'pending'`, [pending.id, now]);
      await this.audit(manager, organizationId, pending.id, null, "owner.transfer.ineligible", "succeeded",
        { reason: "nominee_not_active_administrator", nomineeUserId: pending.nominee_user_id });
    }
  }

  private async lockOwner(manager: EntityManager, organizationId: string): Promise<OwnerRow> {
    const rows = await manager.query<OwnerRow[]>(`select owner_record.user_id, u.display_name
      from app_identity.installation_owner owner_record
      join app_identity.app_user u on u.organization_id = owner_record.organization_id and u.id = owner_record.user_id
      where owner_record.organization_id = $1 for update of owner_record`, [organizationId]);
    if (!rows[0]) throw new ConflictException("Installation ownership has not been established");
    return rows[0];
  }

  private async pending(manager: EntityManager, organizationId: string): Promise<TransferRow | null> {
    const rows = await manager.query<TransferRow[]>(`${this.transferSelect()}
      where transfer.organization_id = $1 and transfer.status = 'pending'
      for update of transfer`, [organizationId]);
    return rows[0] ?? null;
  }

  private async eligible(manager: EntityManager, organizationId: string, userId: string, lock: boolean): Promise<OwnerRow | null> {
    const rows = await manager.query<OwnerRow[]>(`select u.id user_id, u.display_name
      from app_identity.app_user u
      where u.organization_id = $1 and u.id = $2 and u.active and exists (
        select 1 from app_identity.user_role_assignment assignment
        join app_identity.role role on role.organization_id = assignment.organization_id and role.id = assignment.role_id
        where assignment.organization_id = u.organization_id and assignment.user_id = u.id
          and assignment.ended_at is null and role.system_key = 'administrator' and role.active and role.assignable
      )${lock ? " for update of u" : ""}`, [organizationId, userId]);
    return rows[0] ?? null;
  }

  private transferSelect(): string {
    return `select transfer.id, transfer.status, transfer.initiated_at, transfer.expires_at,
      transfer.resolved_at, transfer.resolution_reason, transfer.nominated_by,
      nominator.display_name nominated_by_name, transfer.nominee_user_id, nominee.display_name nominee_name
      from app_identity.ownership_transfer transfer
      join app_identity.app_user nominator on nominator.id = transfer.nominated_by
      join app_identity.app_user nominee on nominee.id = transfer.nominee_user_id`;
  }

  private summary(row: TransferRow): OwnershipTransferSummary {
    return { id: row.id, status: row.status, initiatedAt: iso(row.initiated_at), expiresAt: iso(row.expires_at),
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : null, resolutionReason: row.resolution_reason,
      nominatedBy: { id: row.nominated_by, displayName: row.nominated_by_name },
      nominee: { id: row.nominee_user_id, displayName: row.nominee_name } };
  }

  private audit(manager: EntityManager, organizationId: string, transferId: string | null, actorId: string | null,
    action: string, result: "succeeded" | "failed", details: Record<string, unknown>, note?: string): Promise<unknown> {
    return manager.query(`insert into app_identity.ownership_transfer_event
      (organization_id, transfer_id, actor_id, action, result, note, details)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [organizationId, transferId, actorId, action, result, note ?? null, JSON.stringify(details)]);
  }

  private unwrap<T>(outcome: Outcome<T>): T {
    if ("value" in outcome) return outcome.value!;
    if (outcome.failure === "stale") throw new ForbiddenException("Recent password reauthentication is required for ownership transfer");
    if (outcome.failure === "not_owner") throw new ForbiddenException("Only the current installation owner may nominate a successor");
    if (outcome.failure === "not_nominee") throw new ForbiddenException("Only a party to the pending transfer may perform this action");
    if (outcome.failure === "ineligible") throw new UnprocessableEntityException("The nominee must be an active Administrator");
    throw new ConflictException("The ownership transfer changed or is no longer pending");
  }
}
