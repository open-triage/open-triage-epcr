import {
  ENCOUNTER_DOCUMENT_SCHEMA,
  ENCOUNTER_DOCUMENT_TYPE,
  ENCOUNTER_MODEL_VERSION,
  type ClinicalFormConfiguration,
  type EncounterDocument,
} from "@open-triage/contracts";
import {
  NEMSIS_DATA_MODEL,
  getNemsisDataElement,
  getNemsisGroup,
  resolveNemsisElementValues,
  type NemsisDataElement,
} from "./nemsis-data-model";

export { ENCOUNTER_DOCUMENT_SCHEMA, ENCOUNTER_DOCUMENT_TYPE, ENCOUNTER_MODEL_VERSION };

export type EncounterDocumentDiagnostic = { readonly path: string; readonly message: string };
export type EncounterDocumentCompatibility = {
  readonly nemsisVersion?: string;
  /** When supplied, only these profile ids and versions are loadable. */
  readonly formProfiles?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Report-pinned choices replace the bundled coded set for configured elements. */
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
};

export class EncounterDocumentError extends Error {
  constructor(readonly diagnostics: ReadonlyArray<EncounterDocumentDiagnostic>) {
    super(`Invalid encounter document:\n${diagnostics.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
    this.name = "EncounterDocumentError";
  }
}

const customIdentityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+:[A-Za-z][A-Za-z0-9._-]*$/;
const kinds = new Set(["absent", "null", "pertinent-negative", "coded", "scalar"]);
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(list: EncounterDocumentDiagnostic[], path: string, message: string): void {
  list.push({ path, message });
}

function requireRecord(list: EncounterDocumentDiagnostic[], value: unknown, path: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  diagnostic(list, path, "must be an object");
  return {};
}

function requireString(list: EncounterDocumentDiagnostic[], value: unknown, path: string): value is string {
  if (typeof value === "string" && value.trim()) return true;
  diagnostic(list, path, "must be a non-empty string");
  return false;
}

function validateTimestamp(list: EncounterDocumentDiagnostic[], value: unknown, path: string): void {
  if (!requireString(list, value, path)) return;
  if (!timestampPattern.test(value) || Number.isNaN(Date.parse(value))) diagnostic(list, path, "must be an ISO 8601 date-time with a timezone");
}

function validateAttributes(list: EncounterDocumentDiagnostic[], value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostic(list, path, "must be an object");
    return;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) {
      diagnostic(list, `${path}.${key}`, "must be a string, number, boolean, or null");
    }
  });
}

function duplicateStrings(values: ReadonlyArray<unknown>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (typeof value !== "string") return;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
}

function validateStandardValue(
  list: EncounterDocumentDiagnostic[],
  element: NemsisDataElement,
  value: Record<string, unknown>,
  path: string,
  configured?: ClinicalFormConfiguration["catalogFields"][string],
): void {
  if (value.kind === "null") {
    if (!element.nillable) diagnostic(list, `${path}.kind`, `${element.id} is not nillable in NEMSIS ${NEMSIS_DATA_MODEL.release}`);
    if (value.notValue !== undefined) {
      const notValue = requireRecord(list, value.notValue, `${path}.notValue`);
      if (requireString(list, notValue.code, `${path}.notValue.code`)
        && !element.permittedNotValues.some(({ code }) => code === notValue.code)) {
        diagnostic(list, `${path}.notValue.code`, `code ${notValue.code} is not permitted for ${element.id}`);
      }
    }
    return;
  }
  if (value.kind === "pertinent-negative") {
    if (requireString(list, value.code, `${path}.code`)
      && !element.permittedPertinentNegatives.some(({ code }) => code === value.code)) {
      diagnostic(list, `${path}.code`, `code ${value.code} is not a permitted pertinent negative for ${element.id}`);
    }
    return;
  }
  if (value.kind === "coded") {
    const resolved = resolveNemsisElementValues(element);
    if (resolved.kind === "scalar") diagnostic(list, `${path}.kind`, `${element.id} is scalar, not coded`);
    const validCode = configured?.codeChoices
      ? configured.codeChoices.some(({ code, codeSystem }) => code === value.code
        && (codeSystem || "") === (typeof value.system === "string" ? value.system : ""))
      : resolved.permissibleValues.some(({ code }) => code === value.code);
    if (requireString(list, value.code, `${path}.code`) && resolved.exhaustive && !validCode) {
      diagnostic(list, `${path}.code`, `code ${value.code} is not in the exhaustive value set for ${element.id}`);
    }
    return;
  }
  if (value.kind === "scalar") {
    if (resolveNemsisElementValues(element).kind !== "scalar") diagnostic(list, `${path}.kind`, `${element.id} requires a coded value`);
    const scalar = value.value;
    const { base, constraints } = element.datatype;
    if ((base === "integer" && (typeof scalar !== "number" || !Number.isInteger(scalar)))
      || (["decimal", "double", "float"].includes(base) && typeof scalar !== "number")
      || (base === "boolean" && typeof scalar !== "boolean")
      || (!["integer", "decimal", "double", "float", "boolean"].includes(base) && typeof scalar !== "string")) {
      diagnostic(list, `${path}.value`, `must match the catalog datatype ${base} for ${element.id}`);
      return;
    }
    if (typeof scalar === "number") {
      if (typeof constraints.minInclusive === "number" && scalar < constraints.minInclusive) diagnostic(list, `${path}.value`, `must be at least ${constraints.minInclusive}`);
      if (typeof constraints.maxInclusive === "number" && scalar > constraints.maxInclusive) diagnostic(list, `${path}.value`, `must be at most ${constraints.maxInclusive}`);
    }
    if (typeof scalar === "string") {
      if (typeof constraints.minLength === "number" && scalar.length < constraints.minLength) diagnostic(list, `${path}.value`, `must contain at least ${constraints.minLength} characters`);
      if (typeof constraints.maxLength === "number" && scalar.length > constraints.maxLength) diagnostic(list, `${path}.value`, `must contain at most ${constraints.maxLength} characters`);
      if (typeof constraints.pattern === "string" && !new RegExp(`^(?:${constraints.pattern})$`).test(scalar)) diagnostic(list, `${path}.value`, `must match the catalog pattern for ${element.id}`);
    }
  }
}

function validateValue(
  list: EncounterDocumentDiagnostic[],
  candidate: unknown,
  path: string,
  element?: NemsisDataElement,
  configured?: ClinicalFormConfiguration["catalogFields"][string],
): void {
  const value = requireRecord(list, candidate, path);
  requireString(list, value.occurrenceId, `${path}.occurrenceId`);
  validateAttributes(list, value.attributes, `${path}.attributes`);
  if (!kinds.has(String(value.kind))) {
    diagnostic(list, `${path}.kind`, "must be absent, null, pertinent-negative, coded, or scalar");
    return;
  }
  if (value.kind === "null" && value.notValue !== undefined) {
    const notValue = requireRecord(list, value.notValue, `${path}.notValue`);
    requireString(list, notValue.code, `${path}.notValue.code`);
    if (notValue.display !== undefined && typeof notValue.display !== "string") diagnostic(list, `${path}.notValue.display`, "must be a string");
  }
  if (value.kind === "pertinent-negative" || value.kind === "coded") requireString(list, value.code, `${path}.code`);
  if (value.kind === "coded") {
    if (value.system !== undefined) requireString(list, value.system, `${path}.system`);
    if (value.display !== undefined) requireString(list, value.display, `${path}.display`);
    if (value.terminologyVersion !== undefined) requireString(list, value.terminologyVersion, `${path}.terminologyVersion`);
  }
  if (value.kind === "scalar" && !["string", "number", "boolean"].includes(typeof value.value)) {
    diagnostic(list, `${path}.value`, "must be a string, number, or boolean");
  }
  if (element) validateStandardValue(list, element, value, path, configured);
}

/** Returns every structural and catalog-compatibility problem with a JSON path. */
export function encounterDocumentDiagnostics(
  value: unknown,
  compatibility: EncounterDocumentCompatibility = {},
): ReadonlyArray<EncounterDocumentDiagnostic> {
  const diagnostics: EncounterDocumentDiagnostic[] = [];
  const root = requireRecord(diagnostics, value, "$");
  if (root.$schema !== ENCOUNTER_DOCUMENT_SCHEMA) diagnostic(diagnostics, "$.$schema", `must be ${ENCOUNTER_DOCUMENT_SCHEMA}`);
  if (root.documentType !== ENCOUNTER_DOCUMENT_TYPE) diagnostic(diagnostics, "$.documentType", `must be ${ENCOUNTER_DOCUMENT_TYPE}`);
  if (root.modelVersion !== ENCOUNTER_MODEL_VERSION) diagnostic(diagnostics, "$.modelVersion", `unsupported model version ${String(root.modelVersion)}; expected ${ENCOUNTER_MODEL_VERSION}`);

  const dataModel = requireRecord(diagnostics, root.dataModel, "$.dataModel");
  if (dataModel.standard !== "NEMSIS") diagnostic(diagnostics, "$.dataModel.standard", "must be NEMSIS");
  if (dataModel.dataset !== "EMSDataSet") diagnostic(diagnostics, "$.dataModel.dataset", "must be EMSDataSet");
  const expectedNemsis = compatibility.nemsisVersion ?? NEMSIS_DATA_MODEL.release;
  if (dataModel.version !== expectedNemsis) diagnostic(diagnostics, "$.dataModel.version", `unsupported NEMSIS data-model version ${String(dataModel.version)}; expected ${expectedNemsis}`);

  const formProfile = requireRecord(diagnostics, root.formProfile, "$.formProfile");
  const hasProfileId = requireString(diagnostics, formProfile.id, "$.formProfile.id");
  const hasProfileVersion = requireString(diagnostics, formProfile.version, "$.formProfile.version");
  if (compatibility.formProfiles && hasProfileId && hasProfileVersion) {
    const versions = compatibility.formProfiles[formProfile.id as string];
    if (!versions) diagnostic(diagnostics, "$.formProfile.id", `unsupported form profile ${String(formProfile.id)}`);
    else if (!versions.includes(formProfile.version as string)) {
      diagnostic(diagnostics, "$.formProfile.version", `unsupported version ${String(formProfile.version)} for profile ${String(formProfile.id)}`);
    }
  }

  const encounter = requireRecord(diagnostics, root.encounter, "$.encounter");
  requireString(diagnostics, encounter.id, "$.encounter.id");
  validateTimestamp(diagnostics, encounter.createdAt, "$.encounter.createdAt");
  validateTimestamp(diagnostics, encounter.updatedAt, "$.encounter.updatedAt");

  if (!Array.isArray(root.groups)) {
    diagnostic(diagnostics, "$.groups", "must be an array");
    return diagnostics;
  }
  duplicateStrings(root.groups.map((group) => isRecord(group) ? group.id : undefined)).forEach((id) => {
    diagnostic(diagnostics, "$.groups", `contains duplicate group id ${id}`);
  });
  const allInstanceIds: string[] = [];
  const instanceParents = new Map<string, string>();
  root.groups.forEach((candidateGroup) => {
    if (!isRecord(candidateGroup) || !Array.isArray(candidateGroup.instances)) return;
    candidateGroup.instances.forEach((candidate) => {
      if (isRecord(candidate) && typeof candidate.instanceId === "string") {
        allInstanceIds.push(candidate.instanceId);
        if (typeof candidate.parentInstanceId === "string") instanceParents.set(candidate.instanceId, candidate.parentInstanceId);
      }
    });
  });
  const instanceIds = new Set(allInstanceIds);
  duplicateStrings(allInstanceIds).forEach((id) => diagnostic(diagnostics, "$.groups", `contains duplicate instanceId ${id}`));

  root.groups.forEach((candidateGroup, groupIndex) => {
    const groupPath = `$.groups[${groupIndex}]`;
    const group = requireRecord(diagnostics, candidateGroup, groupPath);
    const hasGroupId = requireString(diagnostics, group.id, `${groupPath}.id`);
    const standardGroup = hasGroupId ? getNemsisGroup(group.id as string) : undefined;
    const customGroup = hasGroupId && customIdentityPattern.test(group.id as string);
    if (hasGroupId && !standardGroup && !customGroup) diagnostic(diagnostics, `${groupPath}.id`, "must be a NEMSIS group id or namespaced custom group id");
    if (!Array.isArray(group.instances) || group.instances.length === 0) {
      diagnostic(diagnostics, `${groupPath}.instances`, "must contain at least one group occurrence");
      return;
    }
    if (standardGroup && standardGroup.occurrence.max !== "unbounded") {
      const maximum = standardGroup.occurrence.max;
      const counts = new Map<string, number>();
      group.instances.forEach((instance) => {
        const parent = isRecord(instance) && typeof instance.parentInstanceId === "string" ? instance.parentInstanceId : "$root";
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
      });
      if ([...counts.values()].some((count) => count > maximum)) {
        diagnostic(diagnostics, `${groupPath}.instances`, `${group.id} permits at most ${maximum} occurrence(s) per parent`);
      }
    }
    duplicateStrings(group.instances.map((instance) => isRecord(instance) ? instance.instanceId : undefined)).forEach((id) => {
      diagnostic(diagnostics, `${groupPath}.instances`, `contains duplicate instanceId ${id}`);
    });

    group.instances.forEach((candidateInstance, instanceIndex) => {
      const instancePath = `${groupPath}.instances[${instanceIndex}]`;
      const instance = requireRecord(diagnostics, candidateInstance, instancePath);
      requireString(diagnostics, instance.instanceId, `${instancePath}.instanceId`);
      if (instance.parentInstanceId !== undefined && requireString(diagnostics, instance.parentInstanceId, `${instancePath}.parentInstanceId`)) {
        if (instance.parentInstanceId === instance.instanceId) diagnostic(diagnostics, `${instancePath}.parentInstanceId`, "must not reference itself");
        else if (!instanceIds.has(instance.parentInstanceId)) diagnostic(diagnostics, `${instancePath}.parentInstanceId`, `references missing instance ${instance.parentInstanceId}`);
        else {
          const seen = new Set([String(instance.instanceId)]);
          let ancestor: string | undefined = String(instance.parentInstanceId);
          while (ancestor !== undefined && !seen.has(ancestor)) { seen.add(ancestor); ancestor = instanceParents.get(ancestor); }
          if (ancestor !== undefined) diagnostic(diagnostics, `${instancePath}.parentInstanceId`, "must not form a parent cycle");
        }
      }
      validateAttributes(diagnostics, instance.attributes, `${instancePath}.attributes`);
      if (!Array.isArray(instance.elements)) {
        diagnostic(diagnostics, `${instancePath}.elements`, "must be an array");
        return;
      }
      duplicateStrings(instance.elements.map((element) => isRecord(element) ? element.id : undefined)).forEach((id) => {
        diagnostic(diagnostics, `${instancePath}.elements`, `contains duplicate element id ${id}`);
      });

      instance.elements.forEach((candidateElement, elementIndex) => {
        const elementPath = `${instancePath}.elements[${elementIndex}]`;
        const elementRecord = requireRecord(diagnostics, candidateElement, elementPath);
        const hasElementId = requireString(diagnostics, elementRecord.id, `${elementPath}.id`);
        const standardElement = hasElementId ? getNemsisDataElement(elementRecord.id as string) : undefined;
        const customElement = hasElementId && customIdentityPattern.test(elementRecord.id as string);
        if (hasElementId && !standardElement && !customElement) {
          diagnostic(diagnostics, `${elementPath}.id`, "must be a NEMSIS element id or namespaced custom element id");
        }
        if (standardElement && hasGroupId && !standardElement.groupPath.includes(group.id as string)) {
          diagnostic(diagnostics, `${elementPath}.id`, `${standardElement.id} does not belong to group ${String(group.id)}`);
        }
        if (!Array.isArray(elementRecord.values) || elementRecord.values.length === 0) {
          diagnostic(diagnostics, `${elementPath}.values`, "must contain at least one explicit value");
          return;
        }
        if (standardElement && standardElement.occurrence.max !== "unbounded" && elementRecord.values.length > standardElement.occurrence.max) {
          diagnostic(diagnostics, `${elementPath}.values`, `${standardElement.id} permits at most ${standardElement.occurrence.max} occurrence(s)`);
        }
        duplicateStrings(elementRecord.values.map((item) => isRecord(item) ? item.occurrenceId : undefined)).forEach((id) => {
          diagnostic(diagnostics, `${elementPath}.values`, `contains duplicate occurrenceId ${id}`);
        });
        elementRecord.values.forEach((item, valueIndex) => validateValue(
          diagnostics,
          item,
          `${elementPath}.values[${valueIndex}]`,
          standardElement,
          hasElementId ? compatibility.catalogFields?.[elementRecord.id as string] : undefined,
        ));
      });
    });
  });
  return diagnostics;
}

/** Validates compatibility and returns a lossless clone, including unknown extensions. */
export function loadEncounterDocument(
  value: unknown,
  compatibility: EncounterDocumentCompatibility = {},
): EncounterDocument {
  const diagnostics = encounterDocumentDiagnostics(value, compatibility);
  if (diagnostics.length) throw new EncounterDocumentError(diagnostics);
  return structuredClone(value) as EncounterDocument;
}

export interface EncounterDocumentNormalization {
  readonly document: unknown;
  readonly removedEmptyElementCount: number;
}

/**
 * Repairs the one recoverable legacy shape that older editors could persist.
 * Everything except element objects with an explicit empty `values` array is
 * retained byte-for-byte at the value level so normal validation can still
 * reject unrelated corruption instead of silently rewriting it.
 */
export function normalizeEmptyEncounterElements(value: unknown): EncounterDocumentNormalization {
  if (!isRecord(value) || !Array.isArray(value.groups)) return { document: value, removedEmptyElementCount: 0 };
  let removedEmptyElementCount = 0;
  const groups = value.groups.map((group) => {
    if (!isRecord(group) || !Array.isArray(group.instances)) return group;
    const originalInstances = group.instances;
    const instances = originalInstances.map((instance) => {
      if (!isRecord(instance) || !Array.isArray(instance.elements)) return instance;
      const elements = instance.elements.filter((element) => {
        const empty = isRecord(element) && Array.isArray(element.values) && element.values.length === 0;
        if (empty) removedEmptyElementCount += 1;
        return !empty;
      });
      return elements.length === instance.elements.length ? instance : { ...instance, elements };
    });
    return instances.every((instance, index) => instance === originalInstances[index]) ? group : { ...group, instances };
  });
  return {
    document: removedEmptyElementCount === 0 ? value : { ...value, groups },
    removedEmptyElementCount,
  };
}

export function serializeEncounterDocument(document: EncounterDocument): string {
  return `${JSON.stringify(sortObjectKeys(loadEncounterDocument(document)), null, 2)}\n`;
}

/** Recursively orders object members while retaining the meaningful order of repeats. */
function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
}

export function deserializeEncounterDocument(
  serialized: string,
  compatibility: EncounterDocumentCompatibility = {},
): EncounterDocument {
  return loadEncounterDocument(JSON.parse(serialized), compatibility);
}
