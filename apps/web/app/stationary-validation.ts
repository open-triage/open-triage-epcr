import { compiledValidationBundleSha256, evaluateValidationBundleSafely, isNemsisDemographicElementId, repairNemsisImportedMessage, type ClinicalFormConfiguration, type EncounterDocument, type EncounterValue } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL, getNemsisDataElement, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";
import { validateScalarInput } from "./stationary-scalar";
import { customTextFindings } from "../components/custom-text-fields";

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
  return findings.filter((finding): finding is StationaryActionableFinding => finding.severity === "error" || finding.severity === "warning");
}

type ClinicalReviewFinding = {
  readonly severity: "error" | "warning";
  readonly target: { readonly groupId: string; readonly elementId?: string };
};

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
  const required = /^(.+?) requires at least (\d+) documented occurrence\(s\)\.?$/.exec(message.trim());
  if (required) return Number(required[2]) === 1
    ? `Record ${required[1]}.`
    : `Record at least ${required[2]} entries for ${required[1]}.`;
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
 * Pinned documentation uses authored rules for clinical findings. The bundled
 * demonstration can still display its own findings when no form is pinned.
 */
export function stationaryReviewFindings<T extends ClinicalReviewFinding>(
  findings: ReadonlyArray<T>,
  clinicalForm?: ClinicalFormConfiguration,
): ReadonlyArray<T> {
  const reportFindings = findings.filter(({ target }) => !isNemsisDemographicElementId(target.elementId ?? "")
    && patientCareGroups.some(({ id }) => id === target.groupId));
  if (!clinicalForm) return reportFindings;
  return [];
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
  if (value.notValue && (!element.permittedNotValues.some(({ code }) => code === value.notValue!.code) ||
      (configured?.choiceOrder !== undefined && !configured.choiceOrder.some((choice) =>
        choice.kind === "not-value" && choice.code === value.notValue!.code)))) {
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
    if ((resolved.exhaustive || configured?.choiceOrder !== undefined) && configuredChoices && !configuredChoices.some(({ code, codeSystem }) =>
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
    return value.notValue && (!element.permittedNotValues.some(({ code }) => code === value.notValue!.code) ||
      (configured?.choiceOrder !== undefined && !configured.choiceOrder.some((choice) =>
        choice.kind === "not-value" && choice.code === value.notValue!.code)))
      ? [finding("value.nv", `${value.notValue.code} is not a permitted not-value for ${element.id}.`, target, element.name)] : [];
  }
  return (configured?.nillable ?? element.nillable) ? [] : [finding("value.absent", `${element.id} requires a value.`, target, element.name)];
}

/**
 * Evaluates every editable target in the pinned stationary catalog. Findings
 * carry enough canonical identity to reopen the exact row and focus its field.
 */
export function validateStationaryRecord(document: EncounterDocument, clinicalForm: ClinicalFormConfiguration | undefined,
  evaluationTimestamp: string, language: string = "en"): ReadonlyArray<StationaryValidationFinding> {
  const findings: StationaryValidationFinding[] = [];
  const authoredBundle = clinicalForm?.validation &&
    compiledValidationBundleSha256(clinicalForm.validation.bundle) === clinicalForm.validation.compiledSha256
    ? clinicalForm.validation.bundle : undefined;
  const configuredFields = clinicalForm
    ? new Set(clinicalForm.definition.sections.flatMap((section) => section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : [])))
    : null;
  const instancesByGroup = new Map(document.groups.map((group) => [group.id, group.instances]));
  const seenInstances = new Set<string>();
  const seenOccurrences = new Set<string>();

  for (const catalogGroup of patientCareGroups) {
    const instances = instancesByGroup.get(catalogGroup.id) ?? [];
    for (const instance of instances) {
      if (seenInstances.has(instance.instanceId)) findings.push(finding("group.identity", `Group occurrence identity ${instance.instanceId} is duplicated.`, { groupId: catalogGroup.id, groupInstanceId: instance.instanceId }, catalogGroup.name));
      seenInstances.add(instance.instanceId);
    }
  }

  for (const element of patientCareElements) {
    if (configuredFields && !configuredFields.has(element.id)) continue;
    const groupId = element.groupPath.at(-1)!;
    const configured = clinicalForm?.catalogFields[element.id];
    const elementInstances = instancesByGroup.get(groupId) ?? [];
    for (const instance of elementInstances) {
      const values = instance.elements.find(({ id }) => id === element.id)?.values ?? [];
      for (const value of values) {
        if (seenOccurrences.has(value.occurrenceId)) findings.push(finding("field.identity", `Value occurrence identity ${value.occurrenceId} is duplicated.`, { groupId, groupInstanceId: instance.instanceId, occurrenceId: value.occurrenceId, fieldId: element.id }, element.name));
        seenOccurrences.add(value.occurrenceId);
        findings.push(...valueFindings(element, instance.instanceId, value, configured));
      }
    }
  }
  if (clinicalForm?.customFields) {
    for (const field of clinicalForm.definition.sections.flatMap(({ fields }) => fields)) {
      if (field.source.kind !== "custom") continue;
      const definition = clinicalForm.customFields[field.source.elementDefinitionId];
      if (!definition) continue;
      const customGroup = field.source.groupDefinitionId ? clinicalForm.customGroups?.[field.source.groupDefinitionId] : undefined;
      const groupId = customGroup ? `${customGroup.namespace}.${customGroup.slug}` : definition.correlatesTo ?? "PatientCareReportGroup";
      const elementId = `${definition.namespace}.${definition.slug}`;
      for (const instance of document.groups.find(({ id }) => id === groupId)?.instances ?? []) {
        const values = instance.elements.find(({ id }) => id === elementId)?.values ?? [];
        for (const value of values) {
          const target = { groupId, groupInstanceId: instance.instanceId, occurrenceId: value.occurrenceId, fieldId: elementId };
          if (definition.datatype !== "coded") {
            const invalid = value.kind === "scalar" ? customTextFindings(definition, value.value, language)
              : [`${definition.title} requires a scalar value.`];
            for (const message of invalid) findings.push(finding("custom.value", message, target, definition.title));
            continue;
          }
          const allowedCodes = field.choicePolicy?.filter((choice) => choice.kind === "code").map((choice) =>
            `${choice.codeSystem}:${choice.code}`);
          const valid = value.kind === "coded"
            ? value.system === definition.codeSystem && definition.choices.some((choice) => choice.code === value.code)
              && (!allowedCodes || allowedCodes.includes(`${value.system}:${value.code}`))
            : value.kind === "null" && value.notValue
              ? definition.permittedNotValues.includes(value.notValue.code) && Boolean(field.allowedAbsenceStates?.includes(value.notValue.code))
              : value.kind === "pertinent-negative"
                ? definition.permittedPertinentNegatives.includes(value.code) && Boolean(field.allowedAbsenceStates?.includes(value.code)) : false;
          if (!valid) findings.push(finding("custom.value", `${definition.title} has an unpermitted choice.`, target, definition.title));
        }
      }
    }
  }
  if (clinicalForm?.validation) {
    if (!evaluationTimestamp) throw new TypeError("An explicit validation evaluation timestamp is required");
    if (!authoredBundle) {
      findings.push(finding(`validation.integrity.${clinicalForm.validation.versionId}`,
        "Live validation is unavailable because the pinned rule artifact failed its integrity check.",
        { groupId: "PatientCareReportGroup" }, "Rule engine"));
      return findings;
    }
    const evaluations = (["live", "sign"] as const).map((target) =>
      evaluateValidationBundleSafely(clinicalForm.validation!.bundle, document, target, { timestamp: evaluationTimestamp, language }));
    const authoredFindings = new Map(evaluations.flatMap(({ findings: evaluatedFindings }) => evaluatedFindings).map((authored) => [
      JSON.stringify([authored.validationVersionId, authored.ruleId, authored.primaryTarget, authored.inputFingerprint]), authored,
    ]));
    for (const authored of authoredFindings.values()) {
      const element = NEMSIS_DATA_MODEL.elements.find(({ id }) => id === authored.primaryTarget.elementId);
      const custom = Object.values(clinicalForm.customFields ?? {}).find((definition) =>
        `${definition.namespace}.${definition.slug}` === authored.primaryTarget.elementId);
      const customGroup = custom?.groupDefinitionId ? clinicalForm.customGroups?.[custom.groupDefinitionId] : undefined;
      const rule = clinicalForm.validation.bundle.rules.find(({ ruleId }) => ruleId === authored.ruleId);
      const message = displayValidationRuleMessage(authored.message, authored.primaryTarget.elementId,
        rule?.references.elementIds ?? []);
      const groupId = element?.groupPath.at(-1) ?? (customGroup ? `${customGroup.namespace}.${customGroup.slug}`
        : custom?.correlatesTo ?? "PatientCareReportGroup");
      findings.push(finding(
        `validation.${authored.validationVersionId}.${authored.ruleId}`,
        message,
        { groupId, ...(authored.primaryTarget.groupInstanceId ? { groupInstanceId: authored.primaryTarget.groupInstanceId } : {}),
          ...(authored.primaryTarget.occurrenceId ? { occurrenceId: authored.primaryTarget.occurrenceId } : {}),
          fieldId: authored.primaryTarget.elementId },
        element?.name ?? custom?.title ?? authored.primaryTarget.elementId,
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
