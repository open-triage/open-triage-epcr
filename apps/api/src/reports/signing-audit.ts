import type { EntityManager } from "typeorm";
import type { SignReportCommand } from "./sign-report.types.js";
import { commandSha256 } from "./draft-report.validation.js";
export async function appendSigningAudit(
    manager: EntityManager,
    report: { id: string; revision: string | number },
    command: SignReportCommand,
    snapshotId: string,
    canonicalSha256: string,
    signedAt: string
  ): Promise<void> {
    const prior = await manager.query<Array<{ report_sequence: string | number; event_hash: string }>>(`
      select report_sequence, event_hash from clinical_audit.event
      where report_id = $1 order by report_sequence desc limit 1`, [report.id]);
    const sequence = prior[0] ? Number(prior[0].report_sequence) + 1 : 1;
    const previousHash = prior[0]?.event_hash ?? null;
    const nextValue = { snapshotId, signedRevision: Number(report.revision), canonicalSha256 };
    const eventHash = commandSha256({
      reportId: report.id, reportSequence: sequence, actorId: command.signerId,
      actorPersona: command.actorPersona ?? null, sessionId: command.sessionId ?? null,
      deviceId: command.deviceId ?? null, clientTime: command.clientTime ?? null,
      serverTime: signedAt, action: "sign", targetType: "signed_snapshot", targetId: snapshotId,
      priorValue: { status: "draft", revision: Number(report.revision) }, newValue: nextValue, previousHash
    });
    await manager.query(`insert into clinical_audit.event
      (report_id, report_sequence, actor_id, actor_persona, session_id, device_id, client_time,
       server_time, action, target_type, target_id, prior_value, new_value, previous_hash, event_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'sign', 'signed_snapshot', $9,
              $10::jsonb, $11::jsonb, $12, $13)`,
    [report.id, sequence, command.signerId, command.actorPersona ?? null, command.sessionId ?? null,
      command.deviceId ?? null, command.clientTime ?? null, signedAt, snapshotId,
      JSON.stringify({ status: "draft", revision: Number(report.revision) }), JSON.stringify(nextValue),
      previousHash, eventHash]);
  }
