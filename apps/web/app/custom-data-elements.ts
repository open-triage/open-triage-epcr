import {
  NEMSIS_DATA_MODEL,
  NEMSIS_ELEMENT_IDS,
  resolveNemsisElementValues,
  type NemsisCodeValue,
  type NemsisDataElement,
  type ResolvedNemsisElementValues,
} from "./nemsis-data-model";

export const CUSTOM_CONFIGURATION_SCHEMA = "./nemsis-custom-configuration.schema-1.0.0.json" as const;
export const CUSTOM_DATATYPE_CODES = {
  binary: "9902001", dateTime: "9902003", number: "9902005", other: "9902007", string: "9902009", boolean: "9902011",
} as const;

export type CustomDatatype = keyof typeof CUSTOM_DATATYPE_CODES;
export type CustomRecurrence = "single" | "multiple";
export type CustomUsage = "Mandatory" | "Required" | "Recommended" | "Optional";
export type CustomCodeValue = NemsisCodeValue & { readonly nemsisCode?: string; readonly description?: string };
export type CustomConstraints = {
  readonly minLength?: number; readonly maxLength?: number; readonly minimum?: number; readonly maximum?: number; readonly pattern?: string;
};
export type CustomGroupDefinition = {
  readonly id: string; readonly title: string; readonly recurrence: CustomRecurrence; readonly correlatesTo?: string;
};
export type CustomElementDefinition = {
  readonly id: string;
  readonly title: string;
  readonly definition: string;
  readonly datatype: CustomDatatype;
  readonly recurrence: CustomRecurrence;
  readonly usage: CustomUsage;
  readonly constraints: CustomConstraints;
  readonly potentialValues: ReadonlyArray<CustomCodeValue>;
  readonly permittedNV: ReadonlyArray<string>;
  readonly permittedPN: ReadonlyArray<string>;
  readonly groupId?: string;
};
export type CustomConfiguration = {
  readonly $schema: typeof CUSTOM_CONFIGURATION_SCHEMA;
  readonly schemaVersion: "1.0.0";
  readonly owner: string;
  readonly namespace: string;
  readonly groups: ReadonlyArray<CustomGroupDefinition>;
  readonly elements: ReadonlyArray<CustomElementDefinition>;
};

export type CustomConfigurationDiagnostic = { readonly path: string; readonly message: string };
export class CustomConfigurationError extends Error {
  constructor(readonly diagnostics: ReadonlyArray<CustomConfigurationDiagnostic>) {
    super(`Invalid NEMSIS custom configuration:\n${diagnostics.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
    this.name = "CustomConfigurationError";
  }
}

const namespacePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const customIdPattern = /^([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+):[A-Za-z][A-Za-z0-9._-]*$/;
const supportedDatatypes = new Set(Object.keys(CUSTOM_DATATYPE_CODES));
const supportedUsage = new Set(["Mandatory", "Required", "Recommended", "Optional"]);
const supportedRecurrence = new Set(["single", "multiple"]);
const allowedConstraintKeys = new Set(["minLength", "maxLength", "minimum", "maximum", "pattern"]);
const standardNvCodes = new Set(NEMSIS_DATA_MODEL.elements.flatMap((element) => element.permittedNotValues.map(({ code }) => code)));
const standardPnCodes = new Set(NEMSIS_DATA_MODEL.elements.flatMap((element) => element.permittedPertinentNegatives.map(({ code }) => code)));

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function diagnostic(list: CustomConfigurationDiagnostic[], path: string, message: string): void { list.push({ path, message }); }
function customNamespace(id: unknown): string | null { return typeof id === "string" ? customIdPattern.exec(id)?.[1] ?? null : null; }
function duplicateValues(values: ReadonlyArray<unknown>): ReadonlyArray<string> {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  values.forEach((value) => { const key = String(value); if (seen.has(key)) duplicates.add(key); else seen.add(key); });
  return [...duplicates];
}

/** Validates the documented JSON contract and cross-definition NEMSIS extension rules. */
export function customConfigurationDiagnostics(value: unknown): ReadonlyArray<CustomConfigurationDiagnostic> {
  const diagnostics: CustomConfigurationDiagnostic[] = [];
  if (!isRecord(value)) return [{ path: "$", message: "configuration must be an object" }];
  if (value.$schema !== CUSTOM_CONFIGURATION_SCHEMA) diagnostic(diagnostics, "$.$schema", `must be ${CUSTOM_CONFIGURATION_SCHEMA}`);
  if (value.schemaVersion !== "1.0.0") diagnostic(diagnostics, "$.schemaVersion", "must be 1.0.0");
  if (typeof value.owner !== "string" || !value.owner.trim()) diagnostic(diagnostics, "$.owner", "must identify the owning organization");
  const namespace = value.namespace;
  if (typeof namespace !== "string" || !namespacePattern.test(namespace)) diagnostic(diagnostics, "$.namespace", "must be a lowercase reverse-DNS namespace such as org.example.ems");
  const groups = Array.isArray(value.groups) ? value.groups : [];
  if (!Array.isArray(value.groups)) diagnostic(diagnostics, "$.groups", "must be an array");
  const groupIds = new Set<string>();
  groups.forEach((candidate, index) => {
    const path = `$.groups[${index}]`; const group = isRecord(candidate) ? candidate : {};
    const idNamespace = customNamespace(group.id);
    if (!idNamespace) diagnostic(diagnostics, `${path}.id`, "must be a namespaced custom identifier");
    else if (idNamespace !== namespace) diagnostic(diagnostics, `${path}.id`, `must belong to namespace ${String(namespace)}`);
    if (typeof group.id === "string") groupIds.add(group.id);
    if (typeof group.title !== "string" || group.title.length < 2 || group.title.length > 100) diagnostic(diagnostics, `${path}.title`, "must contain 2 to 100 characters");
    if (!supportedRecurrence.has(String(group.recurrence))) diagnostic(diagnostics, `${path}.recurrence`, "must be single or multiple");
    if (group.correlatesTo !== undefined && (typeof group.correlatesTo !== "string" || !group.correlatesTo.trim())) diagnostic(diagnostics, `${path}.correlatesTo`, "must be a non-empty standard or custom correlation identity");
  });
  duplicateValues(groups.map((group) => isRecord(group) ? group.id : undefined)).forEach((id) => diagnostic(diagnostics, "$.groups", `contains duplicate group id ${id}`));

  const elements = Array.isArray(value.elements) ? value.elements : [];
  if (!Array.isArray(value.elements)) diagnostic(diagnostics, "$.elements", "must be an array");
  elements.forEach((candidate, index) => {
    const path = `$.elements[${index}]`; const element = isRecord(candidate) ? candidate : {};
    const idNamespace = customNamespace(element.id);
    if (!idNamespace) diagnostic(diagnostics, `${path}.id`, "must be a namespaced custom identifier and cannot use a standard NEMSIS id");
    else if (idNamespace !== namespace) diagnostic(diagnostics, `${path}.id`, `must belong to namespace ${String(namespace)}`);
    if (typeof element.id === "string" && NEMSIS_ELEMENT_IDS.has(element.id)) diagnostic(diagnostics, `${path}.id`, "collides with a standard NEMSIS element");
    if (typeof element.title !== "string" || element.title.length < 2 || element.title.length > 100) diagnostic(diagnostics, `${path}.title`, "must contain 2 to 100 characters");
    if (typeof element.definition !== "string" || element.definition.length < 2 || element.definition.length > 255) diagnostic(diagnostics, `${path}.definition`, "must contain 2 to 255 characters");
    if (!supportedDatatypes.has(String(element.datatype))) diagnostic(diagnostics, `${path}.datatype`, `must be one of ${[...supportedDatatypes].join(", ")}`);
    if (!supportedRecurrence.has(String(element.recurrence))) diagnostic(diagnostics, `${path}.recurrence`, "must be single or multiple");
    if (!supportedUsage.has(String(element.usage))) diagnostic(diagnostics, `${path}.usage`, "must be Mandatory, Required, Recommended, or Optional");
    const constraints = isRecord(element.constraints) ? element.constraints : {};
    if (!isRecord(element.constraints)) diagnostic(diagnostics, `${path}.constraints`, "must be an object");
    Object.keys(constraints).filter((key) => !allowedConstraintKeys.has(key)).forEach((key) => diagnostic(diagnostics, `${path}.constraints.${key}`, "is not supported"));
    for (const key of ["minLength", "maxLength"] as const) if (constraints[key] !== undefined && (!Number.isInteger(constraints[key]) || Number(constraints[key]) < 0)) diagnostic(diagnostics, `${path}.constraints.${key}`, "must be a non-negative integer");
    if (Number(constraints.minLength) > Number(constraints.maxLength)) diagnostic(diagnostics, `${path}.constraints`, "minLength must not exceed maxLength");
    if (Number(constraints.minimum) > Number(constraints.maximum)) diagnostic(diagnostics, `${path}.constraints`, "minimum must not exceed maximum");
    if ((constraints.minimum !== undefined || constraints.maximum !== undefined) && element.datatype !== "number") diagnostic(diagnostics, `${path}.constraints`, "numeric bounds require datatype number");
    if ((constraints.minLength !== undefined || constraints.maxLength !== undefined || constraints.pattern !== undefined) && !["string", "other"].includes(String(element.datatype))) diagnostic(diagnostics, `${path}.constraints`, "text constraints require datatype string or other");
    if (typeof constraints.pattern === "string") { try { new RegExp(constraints.pattern); } catch { diagnostic(diagnostics, `${path}.constraints.pattern`, "must be a valid regular expression"); } }
    const values = Array.isArray(element.potentialValues) ? element.potentialValues : [];
    if (!Array.isArray(element.potentialValues)) diagnostic(diagnostics, `${path}.potentialValues`, "must be an array");
    values.forEach((candidateValue, valueIndex) => {
      const valuePath = `${path}.potentialValues[${valueIndex}]`; const codeValue = isRecord(candidateValue) ? candidateValue : {};
      if (typeof codeValue.code !== "string" || !codeValue.code.trim()) diagnostic(diagnostics, `${valuePath}.code`, "must be non-empty");
      if (typeof codeValue.label !== "string" || !codeValue.label.trim()) diagnostic(diagnostics, `${valuePath}.label`, "must be non-empty");
    });
    duplicateValues(values.map((item) => isRecord(item) ? item.code : undefined)).forEach((code) => diagnostic(diagnostics, `${path}.potentialValues`, `contains duplicate code ${code}`));
    for (const [key, allowed] of [["permittedNV", standardNvCodes], ["permittedPN", standardPnCodes]] as const) {
      const codes = element[key];
      if (!Array.isArray(codes)) diagnostic(diagnostics, `${path}.${key}`, "must be an array");
      else codes.forEach((code, codeIndex) => { if (typeof code !== "string" || !allowed.has(code)) diagnostic(diagnostics, `${path}.${key}[${codeIndex}]`, `code ${String(code)} is not permitted by the NEMSIS 3.5.1 catalog`); });
    }
    if (element.groupId !== undefined) {
      if (typeof element.groupId !== "string" || !groupIds.has(element.groupId)) diagnostic(diagnostics, `${path}.groupId`, "must reference a configured group");
      else {
        const group = groups.find((item) => isRecord(item) && item.id === element.groupId) as Record<string, unknown> | undefined;
        if (group?.recurrence === "single" && element.recurrence === "multiple") diagnostic(diagnostics, `${path}.recurrence`, "cannot be multiple inside a single-occurrence group");
      }
    }
  });
  duplicateValues(elements.map((element) => isRecord(element) ? element.id : undefined)).forEach((id) => diagnostic(diagnostics, "$.elements", `contains duplicate element id ${id}`));
  return diagnostics;
}

export function validateCustomConfiguration(value: unknown): CustomConfiguration {
  const diagnostics = customConfigurationDiagnostics(value);
  if (diagnostics.length) throw new CustomConfigurationError(diagnostics);
  return value as CustomConfiguration;
}

export type StandardCatalogEntry = { readonly provenance: "standard"; readonly owner: "NEMSIS"; readonly element: NemsisDataElement };
export type CustomCatalogEntry = { readonly provenance: "custom"; readonly owner: string; readonly namespace: string; readonly element: CustomElementDefinition };
export type ElementCatalogEntry = StandardCatalogEntry | CustomCatalogEntry;

export interface ElementCatalog {
  readonly size: number;
  list(): ReadonlyArray<ElementCatalogEntry>;
  get(id: string): ElementCatalogEntry | undefined;
  require(id: string): ElementCatalogEntry;
  resolveValues(id: string): ResolvedNemsisElementValues;
}

/** Creates one immutable lookup surface without mutating the generated standard catalog. */
export function createElementCatalog(...configurations: ReadonlyArray<unknown>): ElementCatalog {
  const custom = configurations.map(validateCustomConfiguration);
  const entries = new Map<string, ElementCatalogEntry>();
  NEMSIS_DATA_MODEL.elements.forEach((element) => entries.set(element.id, { provenance: "standard", owner: "NEMSIS", element }));
  custom.forEach((configuration) => configuration.elements.forEach((element) => {
    if (entries.has(element.id)) throw new CustomConfigurationError([{ path: `$.elements[${element.id}]`, message: `identifier ${element.id} is already owned by another catalog entry` }]);
    entries.set(element.id, { provenance: "custom", owner: configuration.owner, namespace: configuration.namespace, element });
  }));
  return Object.freeze({
    size: entries.size,
    list: () => [...entries.values()],
    get: (id: string) => entries.get(id),
    require: (id: string) => { const entry = entries.get(id); if (!entry) throw new Error(`Unknown standard or custom data element ${id}`); return entry; },
    resolveValues: (id: string): ResolvedNemsisElementValues => {
      const entry = entries.get(id); if (!entry) throw new Error(`Unknown standard or custom data element ${id}`);
      if (entry.provenance === "standard") return resolveNemsisElementValues(entry.element);
      return { kind: entry.element.potentialValues.length ? "inline-enumerated" : "scalar", exhaustive: entry.element.potentialValues.length > 0, permissibleValues: entry.element.potentialValues, notValues: entry.element.permittedNV.map((code) => ({ code, label: code })), pertinentNegatives: entry.element.permittedPN.map((code) => ({ code, label: code })), externalCodeSystems: [] };
    },
  });
}

export type ConfiguredElementForm = { readonly id: string; readonly fields: ReadonlyArray<string> };
export function resolveConfiguredElementForm(catalog: ElementCatalog, form: ConfiguredElementForm): ReadonlyArray<ElementCatalogEntry> {
  const seen = new Set<string>();
  return form.fields.map((id, index) => {
    if (seen.has(id)) throw new Error(`forms.${form.id}.fields[${index}] duplicates ${id}`);
    seen.add(id);
    try { return catalog.require(id); } catch { throw new Error(`forms.${form.id}.fields[${index}] references unknown element ${id}`); }
  });
}

export type CustomResultValue = { readonly value?: string; readonly NV?: string; readonly PN?: string; readonly [extension: string]: unknown };
export type CustomResult = { readonly elementId: string; readonly values: ReadonlyArray<CustomResultValue>; readonly correlationId?: string; readonly [extension: string]: unknown };
export type CustomDataSet = { readonly results: ReadonlyArray<CustomResult>; readonly [extension: string]: unknown };

export type CustomResultDiagnostic = { readonly path: string; readonly message: string };

/** Validates known result values while allowing unknown namespaced extensions to pass through unchanged. */
export function customResultDiagnostics(catalog: ElementCatalog, data: CustomDataSet): ReadonlyArray<CustomResultDiagnostic> {
  const diagnostics: CustomResultDiagnostic[] = [];
  data.results.forEach((result, resultIndex) => {
    const resultPath = `customData.results[${resultIndex}]`;
    const entry = catalog.get(result.elementId);
    if (!entry) return;
    if (entry.provenance === "standard") {
      diagnostics.push({ path: `${resultPath}.elementId`, message: "must reference a custom element, not a standard NEMSIS element" });
      return;
    }
    const definition = entry.element;
    if (definition.recurrence === "single" && result.values.length > 1) diagnostics.push({ path: `${resultPath}.values`, message: "contains multiple values for a single-occurrence element" });
    result.values.forEach((item, valueIndex) => {
      const path = `${resultPath}.values[${valueIndex}]`;
      const selected = [item.value !== undefined, item.NV !== undefined, item.PN !== undefined].filter(Boolean).length;
      if (selected !== 1) { diagnostics.push({ path, message: "must contain exactly one of value, NV, or PN" }); return; }
      if (item.NV !== undefined && !definition.permittedNV.includes(item.NV)) diagnostics.push({ path: `${path}.NV`, message: `code ${item.NV} is not permitted for ${definition.id}` });
      if (item.PN !== undefined && !definition.permittedPN.includes(item.PN)) diagnostics.push({ path: `${path}.PN`, message: `code ${item.PN} is not permitted for ${definition.id}` });
      if (item.value === undefined) return;
      const value = item.value;
      if (definition.potentialValues.length && !definition.potentialValues.some(({ code }) => code === value)) diagnostics.push({ path: `${path}.value`, message: `value ${value} is not one of the configured coded values` });
      if (definition.datatype === "number" && (value.trim() === "" || !Number.isFinite(Number(value)))) diagnostics.push({ path: `${path}.value`, message: "must be a number" });
      if (definition.datatype === "boolean" && !["true", "false", "1", "0"].includes(value)) diagnostics.push({ path: `${path}.value`, message: "must be true, false, 1, or 0" });
      if (definition.datatype === "dateTime" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) diagnostics.push({ path: `${path}.value`, message: "must be an ISO 8601 date-time with a timezone" });
      if (definition.datatype === "binary" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) diagnostics.push({ path: `${path}.value`, message: "must be base64 encoded" });
      const length = [...value].length;
      if (definition.constraints.minLength !== undefined && length < definition.constraints.minLength) diagnostics.push({ path: `${path}.value`, message: `must contain at least ${definition.constraints.minLength} characters` });
      if (definition.constraints.maxLength !== undefined && length > definition.constraints.maxLength) diagnostics.push({ path: `${path}.value`, message: `must contain at most ${definition.constraints.maxLength} characters` });
      if (definition.constraints.minimum !== undefined && Number(value) < definition.constraints.minimum) diagnostics.push({ path: `${path}.value`, message: `must be at least ${definition.constraints.minimum}` });
      if (definition.constraints.maximum !== undefined && Number(value) > definition.constraints.maximum) diagnostics.push({ path: `${path}.value`, message: `must be at most ${definition.constraints.maximum}` });
      if (definition.constraints.pattern !== undefined && !new RegExp(definition.constraints.pattern).test(value)) diagnostics.push({ path: `${path}.value`, message: `must match ${definition.constraints.pattern}` });
    });
  });
  return diagnostics;
}

export function validateCustomDataSet(catalog: ElementCatalog, value: unknown): CustomDataSet {
  const data = loadCustomDataSet(value);
  const diagnostics = customResultDiagnostics(catalog, data);
  if (diagnostics.length) throw new Error(`Invalid NEMSIS custom results:\n${diagnostics.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
  return data;
}

/** Loads compatible custom results losslessly, including definitions unknown to this deployment. */
export function loadCustomDataSet(value: unknown): CustomDataSet {
  if (!isRecord(value) || !Array.isArray(value.results)) throw new Error("customData.results must be an array");
  value.results.forEach((candidate, index) => {
    if (!isRecord(candidate) || !customIdPattern.test(String(candidate.elementId))) throw new Error(`customData.results[${index}].elementId must be a namespaced custom identifier`);
    if (!Array.isArray(candidate.values) || candidate.values.length === 0 || candidate.values.some((item) => !isRecord(item))) throw new Error(`customData.results[${index}].values must contain result objects`);
  });
  return structuredClone(value) as CustomDataSet;
}

export function setCustomResult(data: CustomDataSet, result: CustomResult): CustomDataSet {
  const checked = loadCustomDataSet({ results: [result] }).results[0]!;
  const index = data.results.findIndex((candidate) => candidate.elementId === result.elementId && candidate.correlationId === result.correlationId);
  const results = [...data.results];
  if (index === -1) results.push(checked); else results[index] = { ...results[index], ...checked };
  return { ...data, results };
}

export function serializeCustomDataSet(data: CustomDataSet): string { return JSON.stringify(loadCustomDataSet(data)); }
export function deserializeCustomDataSet(serialized: string): CustomDataSet { return loadCustomDataSet(JSON.parse(serialized)); }
