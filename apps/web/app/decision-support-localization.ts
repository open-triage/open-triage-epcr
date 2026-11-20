import type { DecisionSupportDefinition } from "@open-triage/contracts";
import { localizedWestDefinition } from "../../../defines/decision_support/west-localization.mjs";

// The findings picker and result share a view of the immutable report snapshot.
const views = new WeakMap<DecisionSupportDefinition, Map<string, DecisionSupportDefinition>>();

export function localizedDecisionSupportDefinition(pinned: DecisionSupportDefinition, language: string) {
  const cache = views.get(pinned) ?? new Map<string, DecisionSupportDefinition>();
  const existing = cache.get(language);
  if (existing) return existing;
  const view = localizedWestDefinition(pinned, language);
  cache.set(language, view);
  views.set(pinned, cache);
  return view;
}
