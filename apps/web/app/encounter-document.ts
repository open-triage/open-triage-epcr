import type { EncounterDocument } from "@open-triage/contracts";
import {
  NEMSIS_DATA_MODEL,
  getNemsisDataElement,
  getNemsisGroup,
  resolveNemsisElementValues,
  type NemsisDataElement,
} from "./nemsis-data-model";

export const ENCOUNTER_DOCUMENT_SCHEMA = "./encounter-document.schema-1.0.0.json" as const;
export const ENCOUNTER_DOCUMENT_TYPE = "open-triage.encounter" as const;
export const ENCOUNTER_MODEL_VERSION = "1.0.0" as const;

export type EncounterDocumentDiagnostic = { readonly path: string; readonly message: string };
export type EncounterDocumentCompatibility = {
  readonly nemsisVersion?: string;
  /** When supplied, only these profile ids and versions are loadable. */
  readonly formProfiles?: Readonly<Record<string, ReadonlyArray<string>>>;
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
    if (requireString(list, value.code, `${path}.code`) && resolved.exhaustive
      && !resolved.permissibleValues.some(({ code }) => code === value.code)) {
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
  if (value.kind === "scalar" && !["string", "number", "boolean"].includes(typeof value.value)) {
    diagnostic(list, `${path}.value`, "must be a string, number, or boolean");
  }
  if (element) validateStandardValue(list, element, value, path);
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
    if (standardGroup && standardGroup.occurrence.max !== "unbounded" && group.instances.length > standardGroup.occurrence.max) {
      diagnostic(diagnostics, `${groupPath}.instances`, `${group.id} permits at most ${standardGroup.occurrence.max} occurrence(s)`);
    }
    duplicateStrings(group.instances.map((instance) => isRecord(instance) ? instance.instanceId : undefined)).forEach((id) => {
      diagnostic(diagnostics, `${groupPath}.instances`, `contains duplicate instanceId ${id}`);
    });

    group.instances.forEach((candidateInstance, instanceIndex) => {
      const instancePath = `${groupPath}.instances[${instanceIndex}]`;
      const instance = requireRecord(diagnostics, candidateInstance, instancePath);
      requireString(diagnostics, instance.instanceId, `${instancePath}.instanceId`);
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
        elementRecord.values.forEach((item, valueIndex) => validateValue(diagnostics, item, `${elementPath}.values[${valueIndex}]`, standardElement));
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

export function serializeEncounterDocument(document: EncounterDocument): string {
  return JSON.stringify(loadEncounterDocument(document), null, 2);
}

export function deserializeEncounterDocument(
  serialized: string,
  compatibility: EncounterDocumentCompatibility = {},
): EncounterDocument {
  return loadEncounterDocument(JSON.parse(serialized), compatibility);
}
