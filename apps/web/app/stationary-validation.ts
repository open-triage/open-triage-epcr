import { compiledValidationBundleSha256, evaluateValidationBundleSafely, isNemsisDemographicElementId, repairNemsisImportedMessage, type ClinicalFormConfiguration, type EncounterDocument, type EncounterValue } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL, getNemsisDataElement, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";
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
  readonly severity: "error" | "warning" | "information";
  readonly category: string;
  readonly title: string;
  readonly reference: string;
  readonly message: string;
  readonly target: StationaryFindingTarget;
  readonly acknowledged: boolean;
  readonly acknowledgement?: {
    readonly validationVersionId: string;
    readonly ruleId: string;
    readonly targetElementId: string;
    readonly targetGroupInstanceId?: string;
    readonly targetOccurrenceId?: string;
    readonly inputFingerprint: string;
  };
};

export type StationaryActionableFinding = Omit<StationaryValidationFinding, "severity"> & {
  readonly severity: "error" | "warning";
};

export function actionableStationaryFindings(findings: ReadonlyArray<StationaryValidationFinding>): ReadonlyArray<StationaryActionableFinding> {
  return findings.filter((finding): finding is StationaryActionableFinding => finding.severity !== "information");
}

type ClinicalReviewFinding = {
  readonly severity: "error" | "warning";
  readonly target: { readonly groupId: string; readonly elementId?: string };
};

const groupPresentation = new Map(COMPILED_STATIONARY_LAYOUT.groups.map((group) => [group.id, group]));
const elementPresentation = new Map(COMPILED_STATIONARY_LAYOUT.elements.map((element) => [element.id, element]));
const patientCareElements = NEMSIS_DATA_MODEL.elements.filter((element) => element.groupPath.includes("PatientCareReportGroup"));
const patientCareGroups = NEMSIS_DATA_MODEL.groups.filter((group) => group.path.includes("PatientCareReportGroup"));

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

/** Older published NEMSIS imports lost the names inside sch:value-of tags. */
export function displayValidationRuleMessage(message: string, primaryElementId: string,
  referencedElementIds: ReadonlyArray<string>): string {
  const repaired = repairNemsisImportedMessage(message, primaryElementId, referencedElementIds);
  if (repaired !== message) return repaired;
  const missingComparisonNames = /^should be (.+) when is (.+)$/i.exec(message.trim());
  if (missingComparisonNames) {
    const otherId = referencedElementIds.find((id) => id !== primaryElementId);
    if (otherId) return `${getNemsisDataElement(primaryElementId)?.name ?? primaryElementId} should be ${missingComparisonNames[1]} when ${getNemsisDataElement(otherId)?.name ?? otherId} is ${missingComparisonNames[2]}`;
  }
  const recorded = /^(.+?) should be recorded when is recorded\.?$/i.exec(message.trim());
  if (recorded) return `${recorded[1]} should be recorded when ${getNemsisDataElement(primaryElementId)?.name ?? primaryElementId} is recorded.`;
  if (/^should be recorded when is recorded\.?$/i.test(message.trim())) {
    const otherId = referencedElementIds.find((id) => id !== primaryElementId);
    if (otherId) return `${getNemsisDataElement(primaryElementId)?.name ?? primaryElementId} should be recorded when ${getNemsisDataElement(otherId)?.name ?? otherId} is recorded.`;
  }
  if (!/^should not be earlier than\s*\.?$/i.test(message.trim())) return message;
  const otherId = referencedElementIds.find((id) => id !== primaryElementId);
  const primary = getNemsisDataElement(primaryElementId);
  const other = otherId ? getNemsisDataElement(otherId) : undefined;
  return other ? `${primary?.name ?? primaryElementId} should not be earlier than ${other.name}.` : message;
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
  const reportFindings = findings.filter(({ target }) => !isNemsisDemographicElementId(target.elementId ?? "")
    && patientCareGroups.some(({ id }) => id === target.groupId));
  if (!clinicalForm) return reportFindings;
  const configuredElements = new Set(clinicalForm.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" && !isNemsisDemographicElementId(field.source.elementId) ? [field.source.elementId] : [])));
  const configuredGroups = new Set(patientCareElements.filter(({ id }) => configuredElements.has(id))
    .flatMap(({ groupPath }) => groupPath));
  return reportFindings.filter(({ severity, target }) => severity === "warning"
    && (configuredElements.has(target.elementId ?? "") || configuredGroups.has(target.groupId)));
}

function finding(
  code: string,
  message: string,
  target: Omit<StationaryFindingTarget, "sectionId" | "instanceId" | "elementId">,
  title: string,
  severity: StationaryValidationFinding["severity"] = "error",
  authored?: NonNullable<StationaryValidationFinding["acknowledgement"]>,
): StationaryValidationFinding {
  const fieldId = target.fieldId;
  const completeTarget: StationaryFindingTarget = {
    sectionId: sectionId(target.groupId),
    ...target,
    ...(target.groupInstanceId ? { instanceId: target.groupInstanceId } : {}),
    ...(fieldId ? { elementId: fieldId } : {}),
  };
  return {
    id: authored ? ["validation", authored.validationVersionId, authored.ruleId, authored.targetElementId,
      authored.targetGroupInstanceId ?? "root", authored.targetOccurrenceId ?? "none", authored.inputFingerprint]
      .map(encodeURIComponent).join(":")
      : `stationary:${code}:${idPart(target.groupId)}:${idPart(target.groupInstanceId)}:${idPart(target.occurrenceId)}:${idPart(fieldId)}`,
    severity,
    category: "Complete record",
    title,
    reference: fieldId ?? target.groupId,
    message,
    target: completeTarget,
    acknowledged: false,
    ...(authored ? { acknowledgement: authored } : {}),
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
    if (resolved.exhaustive && configuredChoices && !configuredChoices.some(({ code, codeSystem }) =>
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
export function validateStationaryRecord(document: EncounterDocument, clinicalForm: ClinicalFormConfiguration | undefined,
  evaluationTimestamp: string): ReadonlyArray<StationaryValidationFinding> {
  const findings: StationaryValidationFinding[] = [];
  const authoredPolicy = clinicalForm?.validation !== undefined;
  const configuredFields = clinicalForm
    ? new Set(clinicalForm.definition.sections.flatMap((section) => section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))
    : null;
  const formRequired = new Set(clinicalForm?.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" && field.required ? [field.source.elementId] : [])) ?? []);
  const explicitlyRequiredElements = new Set(patientCareElements.filter((element) =>
    formRequired.has(element.id) || clinicalForm?.catalogFields[element.id]?.agencyRequired === true).map(({ id }) => id));
  const explicitlyRequiredGroups = new Set(patientCareElements.filter(({ id }) => explicitlyRequiredElements.has(id))
    .flatMap(({ groupPath }) => groupPath));
  const catalogGroups = new Map(NEMSIS_DATA_MODEL.groups.map((group) => [group.id, group]));
  const instancesByGroup = new Map(document.groups.map((group) => [group.id, group.instances]));
  const seenInstances = new Set<string>();
  const seenOccurrences = new Set<string>();

  for (const catalogGroup of patientCareGroups) {
    const relevant = !configuredFields || patientCareElements.some((element) =>
      configuredFields.has(element.id) && element.groupPath.includes(catalogGroup.id));
    const instances = instancesByGroup.get(catalogGroup.id) ?? [];
    const presentation = groupPresentation.get(catalogGroup.id);
    const parents = catalogGroup.parentId ? instancesByGroup.get(catalogGroup.parentId) ?? [] : [undefined];
    const explicitlyRequired = explicitlyRequiredGroups.has(catalogGroup.id);
    const minimum = catalogGroup.repeating && !explicitlyRequired ? 0 : catalogGroup.occurrence.min;
    const parentIsRepeating = catalogGroup.parentId ? catalogGroups.get(catalogGroup.parentId)?.repeating === true : false;
    const validationParents = parents.length ? parents : explicitlyRequired && !parentIsRepeating ? [undefined] : [];
    if (!authoredPolicy && relevant && presentation?.mode !== "read-only") for (const parent of validationParents) {
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

  for (const element of patientCareElements) {
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
      if (!authoredPolicy && editable && values.length < minimum) findings.push(finding(
        "field.minimum", `${element.name} requires at least ${minimum} value(s); found ${values.length}.`,
        { groupId, groupInstanceId: instance.instanceId, fieldId: element.id }, element.name, requirednessSeverity,
      ));
      if (!authoredPolicy && maximum !== "unbounded" && values.length > maximum) findings.push(finding(
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
    if (!evaluationTimestamp) throw new TypeError("An explicit validation evaluation timestamp is required");
    if (compiledValidationBundleSha256(clinicalForm.validation.bundle) !== clinicalForm.validation.compiledSha256) {
      findings.push(finding(`validation.integrity.${clinicalForm.validation.versionId}`,
        "Live validation is unavailable because the pinned rule artifact failed its integrity check.",
        { groupId: "PatientCareReportGroup" }, "Rule engine"));
      return findings;
    }
    const evaluations = (["live", "sign"] as const).map((target) =>
      evaluateValidationBundleSafely(clinicalForm.validation!.bundle, document, target, { timestamp: evaluationTimestamp }));
    const authoredFindings = new Map(evaluations.flatMap(({ findings: evaluatedFindings }) => evaluatedFindings).map((authored) => [
      JSON.stringify([authored.validationVersionId, authored.ruleId, authored.primaryTarget, authored.inputFingerprint]), authored,
    ]));
    for (const authored of authoredFindings.values()) {
      const element = NEMSIS_DATA_MODEL.elements.find(({ id }) => id === authored.primaryTarget.elementId);
      const rule = clinicalForm.validation.bundle.rules.find(({ ruleId }) => ruleId === authored.ruleId);
      const message = displayValidationRuleMessage(authored.message, authored.primaryTarget.elementId,
        rule?.references.elementIds ?? []);
      const groupId = element?.groupPath.at(-1) ?? "PatientCareReportGroup";
      findings.push(finding(
        `validation.${authored.validationVersionId}.${authored.ruleId}`,
        message,
        { groupId, ...(authored.primaryTarget.groupInstanceId ? { groupInstanceId: authored.primaryTarget.groupInstanceId } : {}),
          ...(authored.primaryTarget.occurrenceId ? { occurrenceId: authored.primaryTarget.occurrenceId } : {}),
          fieldId: authored.primaryTarget.elementId },
        element?.name ?? authored.primaryTarget.elementId,
        authored.severity,
        { validationVersionId: authored.validationVersionId, ruleId: authored.ruleId,
          targetElementId: authored.primaryTarget.elementId,
          ...(authored.primaryTarget.groupInstanceId ? { targetGroupInstanceId: authored.primaryTarget.groupInstanceId } : {}),
          ...(authored.primaryTarget.occurrenceId ? { targetOccurrenceId: authored.primaryTarget.occurrenceId } : {}),
          inputFingerprint: authored.inputFingerprint },
      ));
    }
    for (const failure of evaluations.flatMap(({ failures }) => failures)) findings.push(finding(
      `validation.runtime.${failure.validationVersionId}.${failure.ruleId}`,
      `${failure.message} (rule ${failure.ruleId}).`, { groupId: "PatientCareReportGroup" }, "Rule engine",
    ));
  }
  return findings;
}
