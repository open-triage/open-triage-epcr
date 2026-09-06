import { randomUUID } from "node:crypto";
import { createPasswordVerifier } from "./password.js";

export const BUILT_IN_CAPABILITIES = {
  clinician: ["clinical:document"],
  owner: ["installation:administer", "clinical:document"]
} as const;

export type BuiltInAccountRole = keyof typeof BUILT_IN_CAPABILITIES;

export type Queryable = {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
};

export class AccountService {
  constructor(private readonly database: Queryable) {}

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
    await this.database.query("begin");
    try {
      await this.database.query(
        "insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, $3)",
        [userId, input.organizationId, input.displayName.trim()]
      );
      await this.database.query(
        `insert into app_identity.local_credential
          (user_id, username, password_verifier, must_change_password)
         values ($1, $2, $3, true)`,
        [userId, username, verifier]
      );
      for (const capability of BUILT_IN_CAPABILITIES[input.role]) {
        await this.database.query(
          `insert into app_identity.capability (key, description) values ($1, $2)
           on conflict (key) do nothing`,
          [capability, capability === "installation:administer" ? "Administer installation configuration" : "Document clinical care"]
        );
        await this.database.query(
          "insert into app_identity.user_capability (user_id, capability_key, granted_by) values ($1, $2, $1)",
          [userId, capability]
        );
      }
      await this.database.query(
        `insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id)
         values ($1, $2, 'account.provision', 'succeeded', $2)`,
        [input.organizationId, userId]
      );
      await this.database.query("commit");
      return { userId, username, role: input.role };
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }

  async resetPassword(usernameInput: string, temporaryPassword: string): Promise<{ userId: string; username: string }> {
    const verifier = await createPasswordVerifier(temporaryPassword);
    const username = usernameInput.trim().toLowerCase();
    await this.database.query("begin");
    try {
      const rows = await this.database.query<Array<{ user_id: string; organization_id: string }>>(
        `select c.user_id, u.organization_id
         from app_identity.local_credential c join app_identity.app_user u on u.id = c.user_id
         where c.username = $1 for update`, [username]
      );
      const account = rows[0];
      if (!account) throw new Error("No local account has that username");
      await this.database.query(
        `update app_identity.local_credential
         set password_verifier = $2, must_change_password = true,
             credential_version = credential_version + 1, password_changed_at = null, updated_at = now()
         where user_id = $1`, [account.user_id, verifier]
      );
      await this.database.query(
        `update app_identity.app_session set revoked_at = now(), revocation_reason = 'password_reset'
         where user_id = $1 and revoked_at is null`, [account.user_id]
      );
      await this.database.query(
        `insert into app_identity.authentication_event
          (organization_id, action, result, target_user_id)
         values ($1, 'account.reset_password', 'succeeded', $2)`,
        [account.organization_id, account.user_id]
      );
      await this.database.query("commit");
      return { userId: account.user_id, username };
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
}
