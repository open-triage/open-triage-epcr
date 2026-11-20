import {
  decisionSupportCategoryCriteria,
  decisionSupportCriterionAvailable,
  decisionSupportCriterionLabel,
  decisionSupportFindingCategories,
  decisionSupportNegativeCode,
  decisionSupportPickerCategories,
  type DecisionSupportDefinition,
  type DecisionSupportFindings,
} from "@open-triage/contracts";
import { useRef, useState } from "react";
import { localizedDecisionSupportDefinition } from "../app/decision-support-localization";
import { resolveMessage } from "../app/localization";
import { ClinicalSearchableSelect } from "./clinical-searchable-select";

export function VitalDecisionSupportFindings({ definition: pinned, findings, localTime, language, onChange }: {
  readonly definition: DecisionSupportDefinition;
  readonly findings: DecisionSupportFindings;
  readonly localTime: string;
  readonly language: string;
  readonly onChange: (findings: DecisionSupportFindings) => void;
}) {
  const t = (key: string, params?: Record<string, string>) => resolveMessage(language, key, params);
  const definition = localizedDecisionSupportDefinition(pinned, language);
  const locale = language === "sv" ? "sv" : "en";
  const categories = decisionSupportPickerCategories(definition.categories);
  const documented = decisionSupportFindingCategories(definition, findings.criteria);
  const [categoryId, setCategoryId] = useState(documented[0]?.category.id ?? "");
  const categoryControl = useRef<HTMLSelectElement>(null);
  const category = categories.find(({ id }) => id === categoryId);
  const rows = category ? decisionSupportCategoryCriteria(category) : [];
  const priority = definition.assessment.colourPriority;
  const available = rows.filter(({ criterion }, index) => decisionSupportCriterionAvailable(definition, criterion, localTime) &&
    !findings.criteria.includes(criterion.id) && (!criterion.navigateToCategory || rows.findIndex(({ criterion: other }) =>
      other.navigateToCategory === criterion.navigateToCategory && other.text === criterion.text) === index)).sort((left, right) =>
    priority.indexOf(right.criterion.triage_color) - priority.indexOf(left.criterion.triage_color));
  const noCriteriaLabel = t("mobile.westNoCriteriaMet");
  const chooseFinding = t("mobile.westChooseFinding");
  const negativeCode = decisionSupportNegativeCode(definition, categoryId);
  const displayCategory = (item: typeof categories[number]) => item.displayLabel ?? item.category;
  const select = (code: string) => {
    const removed = code === negativeCode ? new Set([negativeCode, ...rows.map(({ criterion }) => criterion.id)]) : new Set([negativeCode]);
    const criteria = [...findings.criteria.filter((item) => !removed.has(item)), code];
    const selectedColour = rows.find(({ criterion }) => criterion.id === code)?.criterion.triage_color;
    onChange({ criteria, noWarningCriteria: findings.noWarningCriteria && (!selectedColour || selectedColour === "green") });
  };
  const remove = (code: string) => {
    onChange({ ...findings, criteria: findings.criteria.filter((item) => code !== item) });
    categoryControl.current?.focus();
  };
  return <div className="vital-west-findings">
    <label>
      {t("mobile.westCategory")}
      <select ref={categoryControl} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">{t("mobile.westChooseCategory")}</option>
        {categories.map((item) => <option value={item.id} key={item.id}>{displayCategory(item)}</option>)}
      </select>
    </label>
    {category && <ClinicalSearchableSelect label={chooseFinding} placeholder={chooseFinding} options={[
      { key: negativeCode, label: noCriteriaLabel, disabled: findings.criteria.includes(negativeCode) },
      ...available.map(({ criterion, labelSuffix }) => {
        const finding = decisionSupportCriterionLabel(criterion, labelSuffix, locale);
        if (criterion.navigateToCategory) return { key: criterion.id, label: finding };
        return { key: criterion.id, triageColour: criterion.triage_color, label: finding,
          accessibleLabel: t("mobile.westFindingOption", { severity: t(`mobile.westColour.${criterion.triage_color}`), finding }) };
      }),
    ]} onChange={(code) => {
      const target = available.find(({ criterion }) => criterion.id === code)?.criterion.navigateToCategory;
      if (target) setCategoryId(target);
      else select(code);
    }} />}
    {documented.length > 0 && <ul className="vital-west-documented" aria-label={t("mobile.westDocumentedFindings")}>
      {documented.map(({ category: documentedCategory, negative, criteria }) => <li key={documentedCategory.id}>
        <strong>{displayCategory(documentedCategory)}</strong>
        <ul>{(negative ? [{ code: decisionSupportNegativeCode(definition, documentedCategory.id), label: noCriteriaLabel, colour: undefined }]
          : criteria.map(({ criterion, labelSuffix }) => ({
            code: criterion.id, label: decisionSupportCriterionLabel(criterion, labelSuffix, locale), colour: criterion.triage_color,
          }))).map(({ code, label, colour }) => <li key={code} data-west-colour={colour}
            aria-description={colour && t(`mobile.westColour.${colour}`)}>
          <span>{label}</span>
          <button type="button" aria-label={t("mobile.westRemoveFinding", { finding: label })}
            onClick={() => remove(code)}>×</button>
        </li>)}</ul>
      </li>)}
    </ul>}
  </div>;
}
