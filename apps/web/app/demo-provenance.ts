import type { EncounterAttributes } from "@open-triage/contracts";

export const DEMO_PROVENANCE_ATTRIBUTE = "x-open-triage-demo";
export const DEMO_PROVENANCE_VALUE = "stationary-populate-v1";
export const DEMO_GROUP_CORRELATION_PREFIX = `demo:${DEMO_PROVENANCE_VALUE}:`;

export const DEMO_POPULATE_EVENT = "open-triage:demo-populate";
export const DEMO_CLEAR_EVENT = "open-triage:demo-clear";
export const CLINICIAN_OWNER_ATTRIBUTE = "x-open-triage-owner";

/**
 * Fallback calendar date substituted whenever an encounter event, draft, or
 * demo value is missing an explicit date. Centralized so every fallback site
 * shares one source of truth instead of repeating the literal.
 */
export const DEMO_FALLBACK_DATE = "2026-04-18";

export function demoAttributes(extra: EncounterAttributes = {}): EncounterAttributes {
  return { ...extra, [DEMO_PROVENANCE_ATTRIBUTE]: DEMO_PROVENANCE_VALUE };
}

export function hasDemoProvenance(attributes: EncounterAttributes | undefined): boolean {
  return attributes?.[DEMO_PROVENANCE_ATTRIBUTE] === DEMO_PROVENANCE_VALUE;
}

export function withoutDemoProvenance(attributes: EncounterAttributes | undefined): EncounterAttributes | undefined {
  if (!attributes || !hasDemoProvenance(attributes)) return attributes;
  const { [DEMO_PROVENANCE_ATTRIBUTE]: _demo, ...remaining } = attributes;
  return Object.keys(remaining).length ? remaining : undefined;
}

export function clinicianOwnedAttributes(attributes: EncounterAttributes | undefined): EncounterAttributes {
  return { ...withoutDemoProvenance(attributes), [CLINICIAN_OWNER_ATTRIBUTE]: "clinician" };
}
