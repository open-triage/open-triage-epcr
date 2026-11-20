import type { DecisionSupportDefinition, DecisionSupportFieldName, TriageColour } from "@open-triage/contracts";

export function localizedWestDefinition(pinned: DecisionSupportDefinition, language: string): DecisionSupportDefinition;
export function shippedWestDefinition(language?: string): DecisionSupportDefinition;

export const westFhirMapping: {
  readonly fhirVersion: string;
  readonly package: string;
  readonly packageVersion: string;
  readonly packageDate: string;
  readonly sha256: string;
  readonly canonical: string;
  readonly priority: Readonly<Record<TriageColour, string>>;
  readonly complaint: Readonly<Record<string, string>>;
  readonly criterion: Readonly<Record<string, string>>;
  readonly noWarning: string;
};
export const westColourLabels: Record<TriageColour, { en: string; sv: string }>;
export function westCatalogText(field: DecisionSupportFieldName, language: string): { label: string; description: string };
export function westUiMessages(language: string): Record<string, string | { one?: string; other: string }>;
