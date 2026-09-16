import { BadRequestException } from "@nestjs/common";
import type { CreateFeedbackCommand } from "@open-triage/contracts";

const allowedFields = new Set(["idempotencyKey", "type", "description"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCreateFeedback(input: unknown): CreateFeedbackCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Feedback must be an object");
  }
  const record = input as Record<string, unknown>;
  const unexpected = Object.keys(record).filter((key) => !allowedFields.has(key));
  if (unexpected.length) {
    throw new BadRequestException(`Unsupported feedback field: ${unexpected[0]}`);
  }
  if (record.type !== "bug" && record.type !== "feature") {
    throw new BadRequestException("Feedback type must be bug or feature");
  }
  if (typeof record.description !== "string") {
    throw new BadRequestException("Feedback description is required");
  }
  const description = record.description.trim();
  if (!description) throw new BadRequestException("Feedback description is required");
  if (description.length > 4000) {
    throw new BadRequestException("Feedback description must be 4,000 characters or fewer");
  }
  if (typeof record.idempotencyKey !== "string" || !UUID_PATTERN.test(record.idempotencyKey)) {
    throw new BadRequestException("Feedback idempotency key must be a UUID");
  }
  return { idempotencyKey: record.idempotencyKey.toLowerCase(), type: record.type, description };
}
