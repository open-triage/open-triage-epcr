import type { DraftSyncStatus } from "./draft-report";
import type { PresentationMode } from "./presentation-mode";

export type StationarySigningBlocker = "mobile" | "loading" | "offline" | "synchronization" | "error" | "warning" | "dispatch-conflict";

export function stationarySigningBlockers(input: {
  readonly presentationMode: PresentationMode;
  readonly restored: boolean;
  readonly online: boolean;
  readonly syncStatus: DraftSyncStatus;
  readonly errorCount: number;
  readonly warnings: ReadonlyArray<{ readonly acknowledged: boolean }>;
  readonly unresolvedDispatchConflictCount: number;
}): ReadonlyArray<StationarySigningBlocker> {
  const blockers: StationarySigningBlocker[] = [];
  if (input.presentationMode !== "stationary") blockers.push("mobile");
  if (!input.restored) blockers.push("loading");
  if (!input.online) blockers.push("offline");
  if (input.syncStatus !== "Saved") blockers.push("synchronization");
  if (input.errorCount > 0) blockers.push("error");
  if (input.warnings.some(({ acknowledged }) => !acknowledged)) blockers.push("warning");
  if (input.unresolvedDispatchConflictCount > 0) blockers.push("dispatch-conflict");
  return blockers;
}
