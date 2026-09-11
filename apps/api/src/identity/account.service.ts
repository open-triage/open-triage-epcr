import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createPasswordVerifier } from "./password.js";

export const BUILT_IN_ROLES = {
  clinician: ["clinician"],
  owner: ["administrator", "clinician"]
} as const;

export type BuiltInAccountRole = keyof typeof BUILT_IN_ROLES;

export class AccountService {
  constructor(private readonly dataSource: DataSource) {}

  async provision(input: {
    organizationId: string;
    username: string;
    displayName: string;
    role: BuiltInAccountRole;
    temporaryPassword: string;
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
          (user_id, username, password_verifier, must_change_password)
         values ($1, $2, $3, true)`,
        [userId, username, verifier]
      );
      for (const systemKey of BUILT_IN_ROLES[input.role]) {
        await manager.query(
          `insert into app_identity.user_role_assignment
            (organization_id, user_id, role_id, assigned_by, note)
           select $1, $2, id, $2, 'Initial account provisioning'
           from app_identity.role
           where organization_id = $1 and system_key = $3 and protected and active and assignable`,
          [input.organizationId, userId, systemKey]
        );
      }
      await manager.query(
        `insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id)
         values ($1, $2, 'account.provision', 'succeeded', $2)`,
        [input.organizationId, userId]
      );
      return { userId, username, role: input.role };
    });
  }

  async resetPassword(usernameInput: string, temporaryPassword: string): Promise<{ userId: string; username: string }> {
    const verifier = await createPasswordVerifier(temporaryPassword);
    const username = usernameInput.trim().toLowerCase();
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ user_id: string; organization_id: string }>>(
        `select c.user_id, u.organization_id
         from app_identity.local_credential c join app_identity.app_user u on u.id = c.user_id
         where c.username = $1 for update`, [username]
      );
      const account = rows[0];
      if (!account) throw new Error("No local account has that username");
      await manager.query(
        `update app_identity.local_credential
         set password_verifier = $2, must_change_password = true,
             credential_version = credential_version + 1, password_changed_at = null, updated_at = now()
         where user_id = $1`, [account.user_id, verifier]
      );
      await manager.query(
        `update app_identity.app_session set revoked_at = now(), revocation_reason = 'password_reset'
         where user_id = $1 and revoked_at is null`, [account.user_id]
      );
      await manager.query(
        `insert into app_identity.authentication_event
          (organization_id, action, result, target_user_id)
         values ($1, 'account.reset_password', 'succeeded', $2)`,
        [account.organization_id, account.user_id]
      );
      return { userId: account.user_id, username };
    });
  }
}
