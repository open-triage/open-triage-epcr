import { clinicalInstantParts, clinicalWallTimeInput } from "./agency-time-zone";

export function vitalDraftMeasurementInstant(
  draft: { date: string; time: string; dateTime?: string }, timeZone: string | null,
): string | undefined {
  const recorded = draft.dateTime ? clinicalInstantParts(draft.dateTime, timeZone) : undefined;
  if (draft.dateTime && recorded?.date === draft.date && recorded.time === draft.time) return draft.dateTime;
  try { return clinicalWallTimeInput(draft.date, draft.time, timeZone); }
  catch { return undefined; }
}
