import { randomBytes } from "node:crypto";
import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { CreateFeedbackCommand, CreateFeedbackResponse } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { affectedRowCount } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createFeedbackReference(bytes = randomBytes(8)): string {
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && encoded.length < 12) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return encoded.padEnd(12, "A");
}

@Injectable()
export class FeedbackService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async create(sessionToken: string, command: CreateFeedbackCommand): Promise<CreateFeedbackResponse> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.sessions.get(sessionToken, new Date(), false, manager);
      await manager.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [session.user.id]);
      const existing = (await manager.query(`
        select reference_code, submission_type, original_description
        from feedback.submission
        where actor_id = $1 and idempotency_key = $2
      `, [session.user.id, command.idempotencyKey]))[0];
      if (existing) {
        if (existing.submission_type !== command.type || existing.original_description !== command.description) {
          throw new ConflictException("This feedback retry does not match the original draft");
        }
        return { accepted: true, referenceCode: existing.reference_code };
      }

      const recent = (await manager.query(`
        select count(*)::integer submission_count,
          greatest(1, ceil(extract(epoch from (min(created_at) + interval '1 hour' - now()))))::integer retry_after_seconds
        from feedback.submission
        where actor_id = $1 and created_at > now() - interval '1 hour'
      `, [session.user.id]))[0] as { submission_count: number; retry_after_seconds: number | null };
      if (recent.submission_count >= 5) {
        throw new HttpException({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "You have sent five feedback submissions in the last hour. Please try again later.",
          retryAfterSeconds: recent.retry_after_seconds ?? 3600
        }, HttpStatus.TOO_MANY_REQUESTS);
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const referenceCode = createFeedbackReference();
        const result = await manager.query(`
          insert into feedback.submission
            (reference_code, idempotency_key, submission_type, original_description,
             organization_id, actor_id, organization_display_name, actor_display_name)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (reference_code) do nothing
        `, [referenceCode, command.idempotencyKey, command.type, command.description,
          session.organization.id, session.user.id,
          session.organization.name, session.user.displayName]);
        if (affectedRowCount(result) === 1) {
          return { accepted: true, referenceCode };
        }
      }
      throw new Error("Unable to allocate a feedback reference");
    });
  }
}
