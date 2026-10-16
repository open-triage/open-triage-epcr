import type { ClinicalDemoUnit } from "@open-triage/contracts";
import type { BrowserRequestConfiguration } from "./browser-api";
import type { PresentationMode } from "./presentation-mode";
import type { ActiveDraftReport } from "./draft-report";

export function shouldShowClinicalDemoBanner(input: {
  authenticated: boolean;
  capabilities?: ReadonlyArray<string>;
  presentationMode: PresentationMode;
  online: boolean;
  requestMode: BrowserRequestConfiguration["mode"];
}): boolean {
  return input.authenticated && input.online && input.requestMode === "server" &&
    input.presentationMode !== "admin" && input.presentationMode !== "review" &&
    input.capabilities?.includes("clinical:demo") === true;
}

export function selectedClinicalDemoUnit(
  units: ReadonlyArray<ClinicalDemoUnit>,
  currentUnitId = "",
): string {
  if (units.length === 1) return units[0]!.id;
  return units.some(({ id }) => id === currentUnitId) ? currentUnitId : "";
}

/** The server reuses an unopened generated call per selected unit. Other units
 * must remain available to the dispatcher while that call is waiting. */
export function canGenerateSyntheticCall(activeReport: boolean): boolean {
  return !activeReport;
}

/** Uses only the server-qualified record boundary; no document content can opt in. */
export function canUseClinicalDemoDraftActions(
  report: ActiveDraftReport | null,
): report is ActiveDraftReport & { readonly status: "draft"; readonly demoMutable: true } {
  return report?.status === "draft" && report.demoMutable === true;
}
