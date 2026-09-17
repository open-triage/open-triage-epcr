import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ProtectedReportKeyEnvelope, RegisterProtectedReportKeyCommand } from "@open-triage/contracts";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVELOPMENT_SECRET = createHash("sha256").update("open-triage.local-development.offline-recovery.v1").digest();

export interface OfflineRecoveryWrappingKey {
  version: number;
  secret: Buffer;
}

export function offlineRecoveryWrappingKey(environment: NodeJS.ProcessEnv): OfflineRecoveryWrappingKey {
  const versionText = environment.OFFLINE_RECOVERY_KEY_VERSION ?? "1";
  if (!/^[1-9]\d*$/.test(versionText) || !Number.isSafeInteger(Number(versionText))) {
    throw new Error("OFFLINE_RECOVERY_KEY_VERSION must be a positive safe integer");
  }
  const encoded = environment.OFFLINE_RECOVERY_SECRET_BASE64;
  if (!encoded) {
    if (environment.NODE_ENV === "production") {
      throw new Error("OFFLINE_RECOVERY_SECRET_BASE64 is required in production");
    }
    return { version: Number(versionText), secret: DEVELOPMENT_SECRET };
  }
  if (!canonicalBase64.test(encoded)) throw new Error("OFFLINE_RECOVERY_SECRET_BASE64 must be canonical base64");
  const secret = Buffer.from(encoded, "base64");
  if (secret.byteLength !== 32) throw new Error("OFFLINE_RECOVERY_SECRET_BASE64 must decode to exactly 32 bytes");
  return { version: Number(versionText), secret };
}

type RegisteredEnvelopeRow = {
  recovery_handle: string;
  recovery_deadline: Date | string;
  wrapping_key_version: string | number;
  created: boolean;
};

@Injectable()
export class ProtectedReportKeyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async register(
    accessToken: string,
    reportId: string,
    input: unknown,
    csrfToken?: string,
  ): Promise<ProtectedReportKeyEnvelope> {
    const command = this.validate(input);
    const key = Buffer.from(command.reportKeyBase64, "base64");
    const wrapping = offlineRecoveryWrappingKey(process.env);
    const nonce = randomBytes(12);

    return this.dataSource.transaction(async (manager) => {
      await this.sessions.assertCsrf(accessToken, csrfToken, manager);
      const session = await this.sessions.requireCapability(accessToken, "clinical:document", manager);
      const reports = await manager.query<Array<{ organization_id: string; documenting_user_id: string }>>(`
        select organization_id, documenting_user_id
        from clinical.report
        where id = $1 and organization_id = $2 and documenting_user_id = $3 and status = 'draft'
      `, [reportId, session.organization.id, session.user.id]);
      if (!reports[0]) throw new NotFoundException("The protected report is unavailable");

      const associatedData = Buffer.from(JSON.stringify({
        schemaVersion: 1,
        organizationId: session.organization.id,
        reportId,
        ownerUserId: session.user.id,
        recoveryHandle: command.recoveryHandle,
        wrappingKeyVersion: wrapping.version,
      }), "utf8");
      const cipher = createCipheriv("aes-256-gcm", wrapping.secret, nonce);
      cipher.setAAD(associatedData);
      const wrapped = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
      key.fill(0);

      const rows = await manager.query<RegisteredEnvelopeRow[]>(`
        select * from offline_recovery.register_report_key($1, $2, $3, $4, $5, $6, $7)
      `, [reportId, session.organization.id, session.user.id, command.recoveryHandle,
        wrapping.version, nonce, wrapped]);
      const stored = rows[0];
      if (!stored) throw new NotFoundException("The protected report is unavailable");
      if (!stored.created && stored.recovery_handle !== command.recoveryHandle) {
        throw new ConflictException("The report already has protected recovery state");
      }
      return {
        schemaVersion: 1,
        recoveryHandle: stored.recovery_handle,
        recoveryDeadline: new Date(stored.recovery_deadline).toISOString(),
        wrappingKeyVersion: Number(stored.wrapping_key_version),
      };
    });
  }

  private validate(input: unknown): RegisterProtectedReportKeyCommand {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new UnprocessableEntityException("Protected report key registration is invalid");
    }
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["schemaVersion", "recoveryHandle", "reportKeyBase64"].includes(key)) ||
        record.schemaVersion !== 1 || typeof record.recoveryHandle !== "string" || !uuidV4.test(record.recoveryHandle) ||
        typeof record.reportKeyBase64 !== "string" || !canonicalBase64.test(record.reportKeyBase64) ||
        Buffer.from(record.reportKeyBase64, "base64").byteLength !== 32) {
      throw new UnprocessableEntityException("Protected report key registration is invalid");
    }
    return record as unknown as RegisterProtectedReportKeyCommand;
  }
}
