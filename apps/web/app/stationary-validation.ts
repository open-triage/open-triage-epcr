import { evaluateValidationBundle, type ClinicalFormConfiguration, type EncounterDocument, type EncounterValue } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";
import { COMPILED_STATIONARY_LAYOUT } from "./stationary-layout";
import { validateScalarInput } from "./stationary-scalar";

export type StationaryFindingTarget = {
  readonly sectionId: string;
  readonly groupId: string;
  readonly groupInstanceId?: string;
  readonly parentGroupInstanceId?: string;
  readonly occurrenceId?: string;
  readonly fieldId?: string;
  /** Compatibility aliases used by the event-oriented review presentation. */
  readonly instanceId?: string;
  readonly elementId?: string;
};

export type StationaryValidationFinding = {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly category: string;
  readonly title: string;
  readonly reference: string;
  readonly message: string;
  readonly target: StationaryFindingTarget;
  readonly acknowledged: boolean;
};

type ClinicalReviewFinding = {
  readonly severity: "error" | "warning";
  readonly target: { readonly groupId: string; readonly elementId?: string };
};

const groupPresentation = new Map(COMPILED_STATIONARY_LAYOUT.groups.map((group) => [group.id, group]));
const elementPresentation = new Map(COMPILED_STATIONARY_LAYOUT.elements.map((element) => [element.id, element]));

function sectionId(groupId: string): string {
  let current = NEMSIS_DATA_MODEL.groups.find(({ id }) => id === groupId);
  while (current?.parentId && !["HeaderGroup", "PatientCareReportGroup"].includes(current.parentId)) {
    current = NEMSIS_DATA_MODEL.groups.find(({ id }) => id === current!.parentId);
  }
  return current?.id ?? groupId;
}

function idPart(value: string | undefined): string {
  return encodeURIComponent(value ?? "root");
}

/**
 * A pinned form owns structural/requiredness errors, while the encounter review
 * still owns clinical plausibility warnings. Limit those warnings to clinical
 * groups represented by the pinned form so a deliberately omitted workflow
 * does not produce irrelevant findings.
 */
export function stationaryReviewFindings<T extends ClinicalReviewFinding>(
  findings: ReadonlyArray<T>,
  clinicalForm?: ClinicalFormConfiguration,
): ReadonlyArray<T> {
  if (!clinicalForm) return findings;
  const configuredElements = new Set(clinicalForm.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" ? [field.source.elementId] : [])));
  const configuredGroups = new Set(NEMSIS_DATA_MODEL.elements.filter(({ id }) => configuredElements.has(id))
    .flatMap(({ groupPath }) => groupPath));
  return findings.filter(({ severity, target }) => severity === "warning"
    && (configuredElements.has(target.elementId ?? "") || configuredGroups.has(target.groupId)));
}

function finding(
  code: string,
  message: string,
  target: Omit<StationaryFindingTarget, "sectionId" | "instanceId" | "elementId">,
  title: string,
  severity: StationaryValidationFinding["severity"] = "error",
): StationaryValidationFinding {
  const fieldId = target.fieldId;
  const completeTarget: StationaryFindingTarget = {
    sectionId: sectionId(target.groupId),
    ...target,
    ...(target.groupInstanceId ? { instanceId: target.groupInstanceId } : {}),
    ...(fieldId ? { elementId: fieldId } : {}),
  };
  return {
    id: `stationary:${code}:${idPart(target.groupId)}:${idPart(target.groupInstanceId)}:${idPart(target.occurrenceId)}:${idPart(fieldId)}`,
    severity,
    category: "Complete record",
    title,
    reference: fieldId ?? target.groupId,
    message,
    target: completeTarget,
    acknowledged: false,
  };
}

function scalarInput(value: Extract<EncounterValue, { kind: "scalar" }>): string | boolean {
  if (typeof value.value === "boolean") return value.value;
  return String(value.lexical ?? value.value);
}

function valueFindings(element: NemsisDataElement, groupInstanceId: string, value: EncounterValue,
  configured?: ClinicalFormConfiguration["catalogFields"][string]): StationaryValidationFinding[] {
  const target = { groupId: element.groupPath.at(-1)!, groupInstanceId, occurrenceId: value.occurrenceId, fieldId: element.id };
  if (value.notValue && !element.permittedNotValues.some(({ code }) => code === value.notValue!.code)) {
    return [finding("value.nv", `${value.notValue.code} is not a permitted not-value for ${element.id}.`, target, element.name)];
  }
  if (value.pertinentNegative && !element.permittedPertinentNegatives.some(({ code }) => code === value.pertinentNegative!.code)) {
    return [finding("value.pn", `${value.pertinentNegative.code} is not a permitted pertinent-negative for ${element.id}.`, target, element.name)];
  }
  if (value.kind === "scalar") {
    return validateScalarInput(element, scalarInput(value), value.occurrenceId).map((invalid) =>
      finding(`value.${invalid.code}`, invalid.message, target, element.name));
  }
  if (value.kind === "coded") {
    const resolved = resolveNemsisElementValues(element);
    if (resolved.kind === "scalar") return [finding("value.kind", `${element.id} requires a scalar value.`, target, element.name)];
    const configuredChoices = configured?.codeChoices;
    if (configuredChoices && !configuredChoices.some(({ code, codeSystem }) =>
      code === value.code && (!codeSystem || codeSystem === (value.system ?? "")))) {
      return [finding("value.code", `${value.code} is not permitted for ${element.id}.`, target, element.name)];
    }
    if (!configuredChoices && resolved.exhaustive && !resolved.permissibleValues.some(({ code }) => code === value.code)) {
      return [finding("value.code", `${value.code} is not permitted for ${element.id}.`, target, element.name)];
    }
    return [];
  }
  if (value.kind === "pertinent-negative") {
    return element.permittedPertinentNegatives.some(({ code }) => code === value.code) ? []
      : [finding("value.pn", `${value.code} is not a permitted pertinent-negative for ${element.id}.`, target, element.name)];
  }
  if (value.kind === "null") {
    if (!(configured?.nillable ?? element.nillable)) return [finding("value.null", `${element.id} does not permit a null value.`, target, element.name)];
    return value.notValue && !element.permittedNotValues.some(({ code }) => code === value.notValue!.code)
      ? [finding("value.nv", `${value.notValue.code} is not a permitted not-value for ${element.id}.`, target, element.name)] : [];
  }
  return (configured?.nillable ?? element.nillable) ? [] : [finding("value.absent", `${element.id} requires a value.`, target, element.name)];
}

/**
 * Evaluates every editable target in the pinned stationary catalog. Findings
 * carry enough canonical identity to reopen the exact row and focus its field.
 */
export function validateStationaryRecord(document: EncounterDocument, clinicalForm?: ClinicalFormConfiguration): ReadonlyArray<StationaryValidationFinding> {
  const findings: StationaryValidationFinding[] = [];
  const configuredFields = clinicalForm
    ? new Set(clinicalForm.definition.sections.flatMap((section) => section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))
    : null;
  const formRequired = new Set(clinicalForm?.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" && field.required ? [field.source.elementId] : [])) ?? []);
  const explicitlyRequiredElements = new Set(NEMSIS_DATA_MODEL.elements.filter((element) =>
    formRequired.has(element.id) || clinicalForm?.catalogFields[element.id]?.agencyRequired === true).map(({ id }) => id));
  const explicitlyRequiredGroups = new Set(NEMSIS_DATA_MODEL.elements.filter(({ id }) => explicitlyRequiredElements.has(id))
    .flatMap(({ groupPath }) => groupPath));
  const catalogGroups = new Map(NEMSIS_DATA_MODEL.groups.map((group) => [group.id, group]));
  const instancesByGroup = new Map(document.groups.map((group) => [group.id, group.instances]));
  const seenInstances = new Set<string>();
  const seenOccurrences = new Set<string>();

  for (const catalogGroup of NEMSIS_DATA_MODEL.groups) {
    const relevant = !configuredFields || NEMSIS_DATA_MODEL.elements.some((element) =>
      configuredFields.has(element.id) && element.groupPath.includes(catalogGroup.id));
    const instances = instancesByGroup.get(catalogGroup.id) ?? [];
    const presentation = groupPresentation.get(catalogGroup.id);
    const parents = catalogGroup.parentId ? instancesByGroup.get(catalogGroup.parentId) ?? [] : [undefined];
    const explicitlyRequired = explicitlyRequiredGroups.has(catalogGroup.id);
    const minimum = catalogGroup.repeating && !explicitlyRequired ? 0 : catalogGroup.occurrence.min;
    const parentIsRepeating = catalogGroup.parentId ? catalogGroups.get(catalogGroup.parentId)?.repeating === true : false;
    const validationParents = parents.length ? parents : explicitlyRequired && !parentIsRepeating ? [undefined] : [];
    if (relevant && presentation?.mode !== "read-only") for (const parent of validationParents) {
      const count = instances.filter((instance) => (instance.parentInstanceId ?? undefined) === parent?.instanceId).length;
      if (count < minimum) findings.push(finding(
        "group.minimum", `${catalogGroup.name} requires at least ${minimum} occurrence(s); found ${count}.`,
        { groupId: catalogGroup.id, ...(parent ? { parentGroupInstanceId: parent.instanceId } : {}) }, catalogGroup.name,
      ));
      if (catalogGroup.occurrence.max !== "unbounded" && count > catalogGroup.occurrence.max) findings.push(finding(
        "group.maximum", `${catalogGroup.name} permits at most ${catalogGroup.occurrence.max} occurrence(s); found ${count}.`,
        { groupId: catalogGroup.id, ...(parent ? { parentGroupInstanceId: parent.instanceId } : {}) }, catalogGroup.name,
      ));
    }
    for (const instance of instances) {
      if (seenInstances.has(instance.instanceId)) findings.push(finding("group.identity", `Group occurrence identity ${instance.instanceId} is duplicated.`, { groupId: catalogGroup.id, groupInstanceId: instance.instanceId }, catalogGroup.name));
      seenInstances.add(instance.instanceId);
    }
  }

  for (const element of NEMSIS_DATA_MODEL.elements) {
    if (configuredFields && !configuredFields.has(element.id)) continue;
    const groupId = element.groupPath.at(-1)!;
    const configured = clinicalForm?.catalogFields[element.id];
    const editable = elementPresentation.get(element.id)?.mode !== "read-only";
    const elementInstances = instancesByGroup.get(groupId) ?? [];
    const minimum = formRequired.has(element.id) || configured?.agencyRequired ? Math.max(1, configured?.minOccurs ?? element.occurrence.min) : configured?.minOccurs ?? element.occurrence.min;
    const maximum = configured ? configured.maxOccurs ?? "unbounded" : element.occurrence.max;
    const requirednessSeverity = formRequired.has(element.id) ? "error" : configured?.requirednessSeverity ?? "error";
    for (const instance of elementInstances) {
      const values = instance.elements.find(({ id }) => id === element.id)?.values ?? [];
      if (editable && values.length < minimum) findings.push(finding(
        "field.minimum", `${element.name} requires at least ${minimum} value(s); found ${values.length}.`,
        { groupId, groupInstanceId: instance.instanceId, fieldId: element.id }, element.name, requirednessSeverity,
      ));
      if (maximum !== "unbounded" && values.length > maximum) findings.push(finding(
        "field.maximum", `${element.name} permits at most ${maximum} value(s); found ${values.length}.`,
        { groupId, groupInstanceId: instance.instanceId, fieldId: element.id }, element.name,
      ));
      for (const value of values) {
        if (seenOccurrences.has(value.occurrenceId)) findings.push(finding("field.identity", `Value occurrence identity ${value.occurrenceId} is duplicated.`, { groupId, groupInstanceId: instance.instanceId, occurrenceId: value.occurrenceId, fieldId: element.id }, element.name));
        seenOccurrences.add(value.occurrenceId);
        findings.push(...valueFindings(element, instance.instanceId, value, configured));
      }
    }
  }
  if (clinicalForm?.validation) {
    for (const authored of evaluateValidationBundle(clinicalForm.validation.bundle, document, "live")) {
      const element = NEMSIS_DATA_MODEL.elements.find(({ id }) => id === authored.primaryTarget.elementId);
      const groupId = element?.groupPath.at(-1) ?? "PatientCareReportGroup";
      findings.push(finding(
        `validation.${authored.validationVersionId}.${authored.ruleId}`,
        authored.message,
        { groupId, ...(authored.primaryTarget.groupInstanceId ? { groupInstanceId: authored.primaryTarget.groupInstanceId } : {}),
          ...(authored.primaryTarget.occurrenceId ? { occurrenceId: authored.primaryTarget.occurrenceId } : {}),
          fieldId: authored.primaryTarget.elementId },
        element?.name ?? authored.primaryTarget.elementId,
        authored.severity === "information" ? "warning" : authored.severity,
      ));
    }
  }
  return findings;
}
