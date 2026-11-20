import { decisionSupportDefinitionForLanguage, type DecisionSupportDefinition } from "@open-triage/contracts";
import englishWest from "../../../defines/decision_support/west-a-2025.en.json";

export function localizedDecisionSupportDefinition(pinned: DecisionSupportDefinition, language: string) {
  return decisionSupportDefinitionForLanguage(pinned, language, englishWest as DecisionSupportDefinition);
}
