import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const referenceCode = createFeedbackReference();
        const diagnostics = command.diagnostics;
        const result = await manager.query(`
          with inserted as (
            insert into feedback.submission
            (reference_code, submission_type, original_description,
             organization_id, actor_id, organization_display_name, actor_display_name)
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (reference_code) do nothing
            returning id
          )
          insert into feedback.diagnostic
            (submission_id, diagnostic_status, schema_version, unavailable_reason, payload)
          select id, $8, 1, $9, $10::jsonb from inserted
          returning submission_id
        `, [referenceCode, command.type, command.description,
          session.organization.id, session.user.id,
          session.organization.name, session.user.displayName,
          diagnostics.status,
          diagnostics.status === "unavailable" ? diagnostics.reason : null,
          diagnostics.status === "available" ? JSON.stringify(diagnostics.payload) : null]);
        if (affectedRowCount(result) === 1) {
          return { accepted: true, referenceCode };
        }
      }
      throw new Error("Unable to allocate a feedback reference");
    });
  }
}
