import { randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { createPasswordVerifier } from "./password.js";

export const BUILT_IN_ROLES = {
  clinician: ["clinician"],
  administrator: ["administrator"]
} as const;

export type BuiltInAccountRole = keyof typeof BUILT_IN_ROLES;
export type OperatorIdentity = { operatorId: string; osAccount: string; host: string };
type OperatorCommand = "owner.bootstrap" | "owner.reset_password" | "user.reset_password";
type OperatorTarget = { organizationId?: string; userId?: string };

export class AccountService {
  constructor(private readonly dataSource: DataSource) {}

  async provision(input: {
    organizationId: string; username: string; displayName: string;
    role: BuiltInAccountRole; temporaryPassword: string;
  }): Promise<{ userId: string; username: string; role: BuiltInAccountRole }> {
    const verifier = await createPasswordVerifier(input.temporaryPassword);
    const userId = randomUUID();
    const username = input.username.trim().toLowerCase();
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, $3)",
        [userId, input.organizationId, input.displayName.trim()]
      );
      await manager.query(
        `insert into app_identity.local_credential
          (user_id, username, password_verifier, must_change_password, temporary_password_expires_at)
         values ($1, $2, $3, true, now() + interval '72 hours')`, [userId, username, verifier]
      );
      await this.assignProtectedRoles(manager, input.organizationId, userId, BUILT_IN_ROLES[input.role],
        "Initial account provisioning");
      await manager.query(
        `insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id)
         values ($1, $2, 'account.provision', 'succeeded', $2)`, [input.organizationId, userId]
      );
      return { userId, username, role: input.role };
    });
  }

  async bootstrapOwner(input: {
    organizationId: string; username: string; displayName: string;
    temporaryPassword: string; clinician: boolean; operator: OperatorIdentity;
  }): Promise<{ organizationId: string; userId: string; username: string; clinician: boolean }> {
    const userId = randomUUID();
    const target = { organizationId: input.organizationId, userId };
    return this.withFailureAudit("owner.bootstrap", target, input.operator, async () => {
      const verifier = await createPasswordVerifier(input.temporaryPassword);
      const username = input.username.trim().toLowerCase();
      return this.dataSource.transaction(async (manager) => {
        const organizations = await manager.query<Array<{ id: string }>>(
          "select id from app_identity.organization where id = $1 for update", [input.organizationId]
        );
        if (!organizations[0]) throw new Error("No organization has that immutable ID");
        const existing = await manager.query<Array<{ user_id: string }>>(
          "select user_id from app_identity.installation_owner where organization_id = $1", [input.organizationId]
        );
        if (existing[0]) throw new Error("This organization already has an installation owner");
        await manager.query(
          "insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, $3)",
          [userId, input.organizationId, input.displayName.trim()]
        );
        await manager.query(
          `insert into app_identity.local_credential
            (user_id, username, password_verifier, must_change_password, temporary_password_expires_at)
           values ($1, $2, $3, true, now() + interval '72 hours')`, [userId, username, verifier]
        );
        await manager.query(
          `insert into app_identity.installation_owner
            (organization_id, user_id, established_by_operator_id)
           values ($1, $2, $3)`, [input.organizationId, userId, this.operator(input.operator).operatorId]
        );
        await manager.query(
          `insert into app_identity.authentication_event
            (organization_id, actor_id, action, result, target_user_id)
           values ($1, $2, 'account.provision', 'succeeded', $2)`, [input.organizationId, userId]
        );
        await this.auditOperator(manager, "owner.bootstrap", target, input.operator, "succeeded");
        return { organizationId: input.organizationId, userId, username, clinician: true };
      });
    });
  }

  async resetOwnerPassword(organizationId: string, temporaryPassword: string, operator: OperatorIdentity):
    Promise<{ organizationId: string; userId: string }> {
    return this.withFailureAudit("owner.reset_password", { organizationId }, operator, async () => {
      const verifier = await createPasswordVerifier(temporaryPassword);
      return this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Array<{ user_id: string }>>(
          `select owner_record.user_id
           from app_identity.installation_owner owner_record
           join app_identity.local_credential credential on credential.user_id = owner_record.user_id
           where owner_record.organization_id = $1 for update of owner_record, credential`, [organizationId]
        );
        const account = rows[0];
        if (!account) throw new Error("This organization has no recoverable installation owner");
        const target = { organizationId, userId: account.user_id };
        await this.replacePassword(manager, account.user_id, verifier);
        await this.auditOperator(manager, "owner.reset_password", target, operator, "succeeded");
        return { organizationId, userId: account.user_id };
      });
    });
  }

  async resetUserPassword(userId: string, temporaryPassword: string, operator: OperatorIdentity):
    Promise<{ organizationId: string; userId: string }> {
    return this.withFailureAudit("user.reset_password", { userId }, operator, async () => {
      const verifier = await createPasswordVerifier(temporaryPassword);
      return this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Array<{ user_id: string; organization_id: string }>>(
          `select credential.user_id, app_user.organization_id
           from app_identity.local_credential credential
           join app_identity.app_user app_user on app_user.id = credential.user_id
           where credential.user_id = $1 for update of credential`, [userId]
        );
        const account = rows[0];
        if (!account) throw new Error("No local account has that immutable user ID");
        const target = { organizationId: account.organization_id, userId: account.user_id };
        await this.replacePassword(manager, account.user_id, verifier);
        await this.auditOperator(manager, "user.reset_password", target, operator, "succeeded");
        return { organizationId: account.organization_id, userId: account.user_id };
      });
    });
  }

  private async replacePassword(manager: EntityManager, userId: string, verifier: string): Promise<void> {
    await manager.query(
      `update app_identity.local_credential
       set password_verifier = $2, must_change_password = true,
           temporary_password_expires_at = now() + interval '72 hours',
           credential_version = credential_version + 1, password_changed_at = null, updated_at = now()
       where user_id = $1`, [userId, verifier]
    );
    await manager.query(
      `update app_identity.app_session set revoked_at = now(), revocation_reason = 'password_reset'
       where user_id = $1 and revoked_at is null`, [userId]
    );
    await manager.query(
      `insert into app_identity.authentication_event
        (organization_id, action, result, target_user_id)
       select organization_id, 'account.reset_password', 'succeeded', id
       from app_identity.app_user where id = $1`, [userId]
    );
  }

  private async assignProtectedRoles(manager: EntityManager, organizationId: string, userId: string,
    roleKeys: readonly string[], note: string): Promise<void> {
    for (const systemKey of roleKeys) {
      const assigned = await manager.query<Array<{ id: string }>>(
        `insert into app_identity.user_role_assignment
          (organization_id, user_id, role_id, assigned_by, note)
         select $1, $2, id, $2, $4 from app_identity.role
         where organization_id = $1 and system_key = $3 and protected and active and assignable
         returning id`, [organizationId, userId, systemKey, note]
      );
      if (!assigned[0]) throw new Error(`Protected role ${systemKey} is unavailable`);
    }
  }

  private operator(candidate: OperatorIdentity): OperatorIdentity {
    const normalized = { operatorId: candidate.operatorId.trim(), osAccount: candidate.osAccount.trim(), host: candidate.host.trim() };
    if (!normalized.operatorId || !normalized.osAccount || !normalized.host) {
      throw new Error("Operator ID, OS account, and host are required");
    }
    return normalized;
  }

  private async auditOperator(manager: EntityManager, command: OperatorCommand, target: OperatorTarget,
    candidateOperator: OperatorIdentity, result: "succeeded" | "failed"): Promise<void> {
    const operator = this.operator(candidateOperator);
    await manager.query(
      `insert into app_identity.operator_identity_event
        (command, target_organization_id, target_user_id, operator_id, os_account, host, result)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [command, target.organizationId ?? null, target.userId ?? null, operator.operatorId,
        operator.osAccount, operator.host, result]
    );
  }

  private async withFailureAudit<T>(command: OperatorCommand, target: OperatorTarget,
    operator: OperatorIdentity, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      try {
        await this.dataSource.transaction((manager) => this.auditOperator(manager, command, target, operator, "failed"));
      } catch { /* preserve the primary operation failure */ }
      throw error;
    }
  }
}
