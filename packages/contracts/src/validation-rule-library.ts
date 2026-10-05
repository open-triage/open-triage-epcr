import type { ValidationRuleLibraryItem } from "./index.js";
import { reviewPriorityOfRule, validationRuleWordingStatuses } from "./validation-rules.js";

/** Shared filter semantics for the API and an already loaded rule library. */
export function filterValidationRuleLibrary(
  items: readonly ValidationRuleLibraryItem[],
  query: Readonly<Record<string, unknown>>,
): ValidationRuleLibraryItem[] {
  const text = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const search = text("search").trim().toLocaleLowerCase();
  const element = text("element").trim();
  const source = text("source"), severity = text("severity"), priority = text("reviewPriority");
  const target = text("executionTarget"), enabled = text("enabled"), validity = text("validity");
  return items.filter((item) => {
    if (search && ![item.rule.name, item.rule.message, item.rule.source, item.rule.primaryTargetElementId,
      ...(item.rule.provenance ?? []).flatMap((entry) => [entry.sourceIdentity, entry.originalExpression, entry.originalMessage])]
      .join(" ").toLocaleLowerCase().includes(search)) return false;
    if (element && item.rule.primaryTargetElementId !== element && !item.rule.source.includes(`"${element}"`)) return false;
    if (source && item.source !== source || severity && item.rule.severity !== severity) return false;
    if (priority && (!item.rule.executionTargets.includes("review") || reviewPriorityOfRule(item.rule) !== priority)) return false;
    if (target && !item.rule.executionTargets.includes(target as never) || enabled && String(item.rule.enabled) !== enabled) return false;
    if (!validity || item.validity === validity) return true;
    const wording = validationRuleWordingStatuses(item.rule);
    return wording.some((status) => status === validity) || validity === "wording" &&
      (wording.length > 0 || item.diagnostics.some(({ code }) => code === "wording"));
  });
}
