import type { DecisionSupportDefinition, DecisionSupportFieldName, TriageColour } from "@open-triage/contracts";

export function localizedWestDefinition(pinned: DecisionSupportDefinition, language: string): DecisionSupportDefinition;
export function shippedWestDefinition(language?: string): DecisionSupportDefinition;

export const westColourLabels: Record<TriageColour, { en: string; sv: string }>;
export function westCatalogText(field: DecisionSupportFieldName, language: string): { label: string; description: string };
export function westUiMessages(language: string): Record<string, string | { one?: string; other: string }>;
