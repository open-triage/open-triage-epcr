import type { DraftOccurrenceMutation, DraftValue } from "./draft-report.types.js";

export type AmendmentChange =
  | { action: "add"; occurrence: Omit<DraftOccurrenceMutation, "tombstone"> }
  | { action: "replace"; targetElementOccurrenceId: string; value: DraftValue }
  | { action: "remove"; targetElementOccurrenceId: string };

export interface AmendReportCommand {
  commandId: string;
  expectedSequence: number;
  authorId: string;
  reason: string;
  attestation: Record<string, unknown>;
  changes: AmendmentChange[];
  actorPersona?: string;
  sessionId?: string;
  deviceId?: string;
  clientTime?: string;
}

export interface AmendedReportResult {
  id: string;
  status: "signed";
  amendmentId: string;
  amendmentSequence: number;
  canonicalSha256: string;
  authorId: string;
  reason: string;
  signedAt: string;
  changeCount: number;
}
