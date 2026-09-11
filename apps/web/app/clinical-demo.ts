import type { ClinicalDemoUnit, SyntheticCallGenerationContext } from "@open-triage/contracts";
import type { BrowserRequestConfiguration } from "./browser-api";
import type { PresentationMode } from "./presentation-mode";

export function shouldShowClinicalDemoBanner(input: {
  authenticated: boolean;
  capabilities?: ReadonlyArray<string>;
  presentationMode: PresentationMode;
  online: boolean;
  requestMode: BrowserRequestConfiguration["mode"];
}): boolean {
  return input.authenticated && input.online && input.requestMode === "server" &&
    input.presentationMode !== "admin" && input.capabilities?.includes("clinical:demo") === true;
}

export function selectedClinicalDemoUnit(
  units: ReadonlyArray<ClinicalDemoUnit>,
  currentUnitId = "",
): string {
  if (units.length === 1) return units[0]!.id;
  return units.some(({ id }) => id === currentUnitId) ? currentUnitId : "";
}

export function canGenerateSyntheticCall(
  activeReport: boolean,
  context: Pick<SyntheticCallGenerationContext, "hasOpenReport">,
): boolean {
  return !activeReport && !context.hasOpenReport;
}
