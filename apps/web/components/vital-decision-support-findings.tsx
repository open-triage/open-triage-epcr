import {
  decisionSupportCategoryCriteria,
  decisionSupportCriterionAvailable,
  decisionSupportCriterionLabel,
  decisionSupportFindingCategories,
  decisionSupportFindingResult,
  decisionSupportNegativeCode,
  decisionSupportPickerCategories,
  type DecisionSupportDefinition,
  type DecisionSupportFindings,
} from "@open-triage/contracts";
import { useId, useRef, useState } from "react";
import { resolveMessage } from "../app/localization";

export function VitalDecisionSupportFindings({ definition, findings, localTime, language, onChange }: {
  readonly definition: DecisionSupportDefinition;
  readonly findings: DecisionSupportFindings;
  readonly localTime: string;
  readonly language: string;
  readonly onChange: (findings: DecisionSupportFindings) => void;
}) {
  const t = (key: string, params?: Record<string, string>) => resolveMessage(language, key, params);
  const locale = language === "sv" ? "sv" : "en";
  const categories = decisionSupportPickerCategories(definition.categories);
  const documented = decisionSupportFindingCategories(definition, findings.criteria);
  const [categoryId, setCategoryId] = useState(documented[0]?.category.id ?? "");
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const categoryControl = useRef<HTMLSelectElement>(null);
  const listId = useId();
  const category = categories.find(({ id }) => id === categoryId);
  const rows = category ? decisionSupportCategoryCriteria(category) : [];
  const priority = definition.assessment.colourPriority;
  const available = rows.filter(({ criterion }, index) => decisionSupportCriterionAvailable(definition, criterion, localTime) &&
    !findings.criteria.includes(criterion.id) && (!criterion.navigateToCategory || rows.findIndex(({ criterion: other }) =>
      other.navigateToCategory === criterion.navigateToCategory && other.text === criterion.text) === index)).sort((left, right) =>
    priority.indexOf(right.criterion.triage_color) - priority.indexOf(left.criterion.triage_color));
  const noCriteriaLabel = definition.assessment.elements.criteria.noneOption.label[locale];
  const negativeCode = decisionSupportNegativeCode(definition, categoryId);
  const hasWarning = decisionSupportFindingResult(definition, findings, localTime).highest?.criterion.triage_color;
  const warningPresent = !!hasWarning && hasWarning !== "green";
  const displayCategory = (item: typeof categories[number]) => item.displayLabel ?? item.category;
  const closeChoices = () => { setExpanded(false); trigger.current?.focus(); };
  const select = (code: string) => {
    const removed = code === negativeCode ? new Set([negativeCode, ...rows.map(({ criterion }) => criterion.id)]) : new Set([negativeCode]);
    const criteria = [...findings.criteria.filter((item) => !removed.has(item)), code];
    const selectedColour = rows.find(({ criterion }) => criterion.id === code)?.criterion.triage_color;
    onChange({ criteria, noWarningCriteria: findings.noWarningCriteria && (!selectedColour || selectedColour === "green") });
    closeChoices();
  };
  const remove = (code: string) => {
    onChange({ ...findings, criteria: findings.criteria.filter((item) => code !== item) });
    categoryControl.current?.focus();
  };
  return <div className="vital-west-findings" onKeyDown={(event) => {
    if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); closeChoices(); }
  }}>
    <label>
      {t("mobile.westCategory")}
      <select ref={categoryControl} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setExpanded(false); }}>
        <option value="">{t("mobile.westChooseCategory")}</option>
        {categories.map((item) => <option value={item.id} key={item.id}>{displayCategory(item)}</option>)}
      </select>
    </label>
    {category && <div>
      <button ref={trigger} type="button" aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpanded(!expanded)}>{t("mobile.westChooseFinding")}</button>
      {expanded && <ul id={listId} className="vital-west-choices">
        {available.map(({ criterion, labelSuffix }) => <li key={criterion.id}>
          <button type="button" value={criterion.id} onClick={() => {
            if (criterion.navigateToCategory) {
              setCategoryId(criterion.navigateToCategory);
              closeChoices();
            } else select(criterion.id);
          }}>
            {criterion.navigateToCategory ? null : <span className="vital-west-severity">
              <span className="vital-decision-support-indicator" data-colour={criterion.triage_color} aria-hidden="true" />
              {t(`mobile.westColour.${criterion.triage_color}`)}
            </span>}
            <span>{decisionSupportCriterionLabel(criterion, labelSuffix, locale)}</span>
          </button>
        </li>)}
        <li><button type="button" value={negativeCode} disabled={findings.criteria.includes(negativeCode)}
          onClick={() => select(negativeCode)}>{noCriteriaLabel}</button></li>
      </ul>}
    </div>}
    {documented.length > 0 && <ul className="vital-west-documented" aria-label={t("mobile.westDocumentedFindings")}>
      {documented.map(({ category: documentedCategory, negative, criteria }) => <li key={documentedCategory.id}>
        <strong>{displayCategory(documentedCategory)}</strong>
        <ul>{(negative ? [{ code: decisionSupportNegativeCode(definition, documentedCategory.id), label: noCriteriaLabel }]
          : criteria.map(({ criterion, labelSuffix }) => ({
            code: criterion.id, label: decisionSupportCriterionLabel(criterion, labelSuffix, locale),
          }))).map(({ code, label }) => <li key={code}>
          <span>{label}</span>
          <button type="button" aria-label={t("mobile.westRemoveFinding", { finding: label })}
            onClick={() => remove(code)}>×</button>
        </li>)}</ul>
      </li>)}
    </ul>}
    <label className="vital-west-no-warning">
      <input type="checkbox" checked={findings.noWarningCriteria && !warningPresent}
        disabled={warningPresent} onChange={(event) => onChange({ ...findings, noWarningCriteria: event.target.checked })} />
      {t("mobile.westNoWarningCriteria")}
    </label>
  </div>;
}
