import type { EncounterValue } from "@open-triage/contracts";
import { requireNemsisDataElement, type NemsisDataElement } from "./nemsis-data-model";

export type StationaryExceptionalChoice =
  | { readonly key: "null"; readonly kind: "null"; readonly label: "No value" }
  | { readonly key: `not-value:${string}`; readonly kind: "null"; readonly code: string; readonly label: string }
  | { readonly key: `pertinent-negative:${string}`; readonly kind: "pertinent-negative"; readonly code: string; readonly label: string };

export type StationaryExceptionalSelection =
  | { readonly kind: "null"; readonly code?: string; readonly display?: string }
  | { readonly kind: "pertinent-negative"; readonly code: string; readonly display?: string };

/** Catalog-owned exceptional states shared by every datatype-specific picker. */
export function stationaryExceptionalChoices(elementOrId: NemsisDataElement | string): ReadonlyArray<StationaryExceptionalChoice> {
  const element = typeof elementOrId === "string" ? requireNemsisDataElement(elementOrId) : elementOrId;
  return [
    ...(element.nillable && element.permittedNotValues.length === 0
      ? [{ key: "null", kind: "null", label: "No value" } as const]
      : []),
    ...element.permittedNotValues.map(({ code, label }) => ({ key: `not-value:${code}` as const, kind: "null" as const, code, label })),
    ...element.permittedPertinentNegatives.map(({ code, label }) => ({ key: `pertinent-negative:${code}` as const, kind: "pertinent-negative" as const, code, label })),
  ];
}

export function stationaryExceptionalKey(value: EncounterValue | undefined): string {
  if (value?.kind === "null") return value.notValue ? `not-value:${value.notValue.code}` : "null";
  return value?.kind === "pertinent-negative" ? `pertinent-negative:${value.code}` : "";
}

export function stationaryExceptionalSelection(
  elementOrId: NemsisDataElement | string,
  key: string,
): StationaryExceptionalSelection | undefined {
  if (!key) return undefined;
  const element = typeof elementOrId === "string" ? requireNemsisDataElement(elementOrId) : elementOrId;
  const choice = stationaryExceptionalChoices(element).find((candidate) => candidate.key === key);
  if (!choice) throw new Error(`${key} is not permitted for ${element.id}`);
  if (choice.kind === "pertinent-negative") return { kind: choice.kind, code: choice.code, display: choice.label };
  return { kind: "null", ...(choice.key === "null" ? {} : { code: choice.code, display: choice.label }) };
}

export function validateStationaryExceptionalSelection(
  elementOrId: NemsisDataElement | string,
  selection: StationaryExceptionalSelection,
): void {
  const element = typeof elementOrId === "string" ? requireNemsisDataElement(elementOrId) : elementOrId;
  const key = selection.kind === "null" && !selection.code
    ? "null"
    : `${selection.kind === "null" ? "not-value" : "pertinent-negative"}:${selection.code}`;
  if (!stationaryExceptionalChoices(element).some((choice) => choice.key === key)) {
    throw new Error(`${key} is not permitted for ${element.id}`);
  }
}
