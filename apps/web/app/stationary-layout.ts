import source from "./data/stationary-layout-1.0.0.json";
import { NEMSIS_DATA_MODEL } from "./nemsis-data-model";
import { validateCustomConfiguration, type CustomConfiguration } from "./custom-data-elements";

export type StationaryMode = "editable" | "enhanced" | "read-only";
export type StationaryDiagnostic = { readonly path: string; readonly message: string };
export type StationaryColumn = { readonly elementId: string; readonly label?: string; readonly width?: string };
export type StationaryGroupPlacement = {
  readonly id: string; readonly parentId: string | null; readonly mode: StationaryMode;
  readonly presentation: { readonly kind: "inline" | "table"; readonly label?: string; readonly help?: string; readonly dialog?: { readonly addLabel: string; readonly editLabel: string }; readonly columns?: ReadonlyArray<StationaryColumn> };
};
export type StationaryElementPlacement = { readonly id: string; readonly groupId: string; readonly mode: StationaryMode; readonly label?: string; readonly help?: string };
export type StationaryLayout = {
  readonly $schema: "./stationary-layout.schema-1.0.0.json"; readonly schemaVersion: "1.0.0"; readonly profileId: string;
  readonly catalog: { readonly release: "3.5.1"; readonly dataset: "EMSDataSet"; readonly elementCount: number; readonly groupCount: number };
  readonly customNamespaces: ReadonlyArray<string>; readonly groups: ReadonlyArray<StationaryGroupPlacement>; readonly elements: ReadonlyArray<StationaryElementPlacement>;
};
export type CompiledStationaryGroup = StationaryGroupPlacement & { readonly children: ReadonlyArray<CompiledStationaryGroup>; readonly elements: ReadonlyArray<StationaryElementPlacement> };
export type CompiledStationaryLayout = StationaryLayout & { readonly hierarchy: ReadonlyArray<CompiledStationaryGroup> };

const forbiddenSemantics = new Set(["datatype", "cardinality", "occurrence", "constraints", "usage", "valueSource", "valueSet", "values", "codedValues", "permissibleValues", "NV", "PN", "permittedNV", "permittedPN", "permittedNotValues", "permittedPertinentNegatives", "nillable"]);
const namespacePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const customIdPattern = /^([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+):[A-Za-z][A-Za-z0-9._-]*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function duplicateIndexes(items: ReadonlyArray<unknown>, key: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  items.forEach((item, index) => { const id = isRecord(item) ? item[key] : undefined; if (typeof id === "string") found.set(id, [...found.get(id) ?? [], index]); });
  return new Map([...found].filter(([, indexes]) => indexes.length > 1));
}

/** Validates both the JSON contract and all catalog/profile cross-reference invariants. */
export function stationaryLayoutDiagnostics(value: unknown, customValues: ReadonlyArray<unknown> = []): ReadonlyArray<StationaryDiagnostic> {
  const diagnostics: StationaryDiagnostic[] = [];
  const add = (path: string, message: string) => diagnostics.push({ path, message });
  if (!isRecord(value)) return [{ path: "$", message: "layout must be an object" }];
  for (const key of Object.keys(value)) if (!["$schema", "schemaVersion", "profileId", "catalog", "customNamespaces", "groups", "elements"].includes(key)) add(`$.${key}`, forbiddenSemantics.has(key) ? "cannot override catalog-owned semantics" : "is not a supported layout property");
  if (value.$schema !== "./stationary-layout.schema-1.0.0.json") add("$.$schema", "must reference stationary-layout.schema-1.0.0.json");
  if (value.schemaVersion !== "1.0.0") add("$.schemaVersion", "must be 1.0.0");
  const catalogMetadata = isRecord(value.catalog) ? value.catalog : {};
  if (catalogMetadata.release !== NEMSIS_DATA_MODEL.release) add("$.catalog.release", `must match pinned catalog ${NEMSIS_DATA_MODEL.release}`);
  if (catalogMetadata.dataset !== NEMSIS_DATA_MODEL.dataset) add("$.catalog.dataset", `must match pinned catalog ${NEMSIS_DATA_MODEL.dataset}`);
  if (catalogMetadata.elementCount !== NEMSIS_DATA_MODEL.elements.length) add("$.catalog.elementCount", `must equal pinned catalog coverage ${NEMSIS_DATA_MODEL.elements.length}`);
  if (catalogMetadata.groupCount !== NEMSIS_DATA_MODEL.groups.length) add("$.catalog.groupCount", `must equal pinned catalog coverage ${NEMSIS_DATA_MODEL.groups.length}`);

  const customConfigurations: CustomConfiguration[] = [];
  customValues.forEach((custom, index) => { try { customConfigurations.push(validateCustomConfiguration(custom)); } catch (error) { add(`$custom[${index}]`, error instanceof Error ? error.message : "invalid custom configuration"); } });
  const customElements = new Map(customConfigurations.flatMap((configuration) => configuration.elements.map((element) => [element.id, { element, namespace: configuration.namespace }] as const)));
  const customGroups = new Map(customConfigurations.flatMap((configuration) => configuration.groups.map((group) => [group.id, { group, namespace: configuration.namespace }] as const)));
  const declaredNamespaces = Array.isArray(value.customNamespaces) ? value.customNamespaces : [];
  declaredNamespaces.forEach((namespace, index) => { if (typeof namespace !== "string" || !namespacePattern.test(namespace)) add(`$.customNamespaces[${index}]`, "must be a lowercase reverse-DNS namespace"); });
  const namespaceSet = new Set(declaredNamespaces.filter((item): item is string => typeof item === "string"));
  if (namespaceSet.size !== declaredNamespaces.length) add("$.customNamespaces", "contains a duplicate namespace");

  const groups = Array.isArray(value.groups) ? value.groups : [];
  if (!Array.isArray(value.groups)) add("$.groups", "must be an array");
  const standardGroupMap = new Map(NEMSIS_DATA_MODEL.groups.map((group) => [group.id, group]));
  const layoutGroupMap = new Map<string, Record<string, unknown>>();
  groups.forEach((candidate, index) => {
    const path = `$.groups[${index}]`; const placement = isRecord(candidate) ? candidate : {};
    for (const key of Object.keys(placement)) if (!["id", "parentId", "mode", "presentation"].includes(key)) add(`${path}.${key}`, forbiddenSemantics.has(key) ? "cannot override catalog-owned semantics" : "is not supported");
    const id = placement.id;
    if (typeof id !== "string") { add(`${path}.id`, "must be a stable group identity"); return; }
    layoutGroupMap.set(id, placement);
    const standard = standardGroupMap.get(id); const custom = customGroups.get(id);
    if (!standard && !custom) add(`${path}.id`, `unknown standard or namespaced custom group ${id}`);
    const match = customIdPattern.exec(id);
    if (match && (!namespaceSet.has(match[1]!) || custom?.namespace !== match[1])) add(`${path}.id`, `custom identity must belong to a declared configured namespace ${match[1]}`);
    const expectedParent = standard ? standard.parentId : custom ? "eCustomResultsSection" : undefined;
    if (placement.parentId !== expectedParent) add(`${path}.parentId`, `invalid group ancestry; expected ${expectedParent ?? "null"}`);
    if (!["editable", "enhanced", "read-only"].includes(String(placement.mode))) add(`${path}.mode`, "must be editable, enhanced, or read-only");
    const presentation = isRecord(placement.presentation) ? placement.presentation : {};
    if (!isRecord(placement.presentation)) add(`${path}.presentation`, "must be an object");
    for (const key of Object.keys(presentation)) if (!["kind", "label", "help", "dialog", "columns"].includes(key)) add(`${path}.presentation.${key}`, forbiddenSemantics.has(key) ? "cannot override catalog-owned semantics" : "is not supported");
    if (!new Set(["inline", "table"]).has(String(presentation.kind))) add(`${path}.presentation.kind`, "must be inline or table");
    if (standard && presentation.kind === "table" && !standard.repeating) add(`${path}.presentation.kind`, "table presentation requires a catalog-repeating group");
  });
  duplicateIndexes(groups, "id").forEach((indexes, id) => indexes.slice(1).forEach((index) => add(`$.groups[${index}].id`, `duplicates group ${id}`)));
  for (const group of NEMSIS_DATA_MODEL.groups) if (!layoutGroupMap.has(group.id)) add("$.groups", `missing catalog group ${group.id}`);

  const elements = Array.isArray(value.elements) ? value.elements : [];
  if (!Array.isArray(value.elements)) add("$.elements", "must be an array");
  const standardElementMap = new Map(NEMSIS_DATA_MODEL.elements.map((element) => [element.id, element]));
  const layoutElementMap = new Map<string, Record<string, unknown>>();
  elements.forEach((candidate, index) => {
    const path = `$.elements[${index}]`; const placement = isRecord(candidate) ? candidate : {};
    for (const key of Object.keys(placement)) if (!["id", "groupId", "mode", "label", "help"].includes(key)) add(`${path}.${key}`, forbiddenSemantics.has(key) ? "cannot override catalog-owned semantics" : "is not supported");
    const id = placement.id;
    if (typeof id !== "string") { add(`${path}.id`, "must be a stable element identity"); return; }
    layoutElementMap.set(id, placement);
    const standard = standardElementMap.get(id); const custom = customElements.get(id);
    if (!standard && !custom) add(`${path}.id`, `unknown standard or namespaced custom element ${id}`);
    const match = customIdPattern.exec(id);
    if (match && (!namespaceSet.has(match[1]!) || custom?.namespace !== match[1])) add(`${path}.id`, `custom identity must belong to a declared configured namespace ${match[1]}`);
    const expectedGroup = standard?.groupPath.at(-1) ?? custom?.element.groupId ?? "eCustomResultsSection";
    if (placement.groupId !== expectedGroup) add(`${path}.groupId`, `invalid group ancestry; expected ${expectedGroup}`);
    if (!["editable", "enhanced", "read-only"].includes(String(placement.mode))) add(`${path}.mode`, "must be editable, enhanced, or read-only");
    if (standard && !standard.groupPath.includes("PatientCareReportGroup") && placement.mode !== "read-only") add(`${path}.mode`, "agency/configuration metadata must be read-only");
  });
  duplicateIndexes(elements, "id").forEach((indexes, id) => indexes.slice(1).forEach((index) => add(`$.elements[${index}].id`, `duplicates element ${id}`)));
  for (const element of NEMSIS_DATA_MODEL.elements) if (!layoutElementMap.has(element.id)) add("$.elements", `missing catalog element ${element.id}`);

  groups.forEach((candidate, groupIndex) => {
    if (!isRecord(candidate) || !isRecord(candidate.presentation) || !Array.isArray(candidate.presentation.columns)) return;
    candidate.presentation.columns.forEach((column, columnIndex) => {
      const path = `$.groups[${groupIndex}].presentation.columns[${columnIndex}].elementId`;
      const id = isRecord(column) ? column.elementId : undefined; const element = typeof id === "string" ? standardElementMap.get(id) : undefined;
      if (!element && !customElements.has(String(id))) add(path, `unknown standard or namespaced custom element ${String(id)}`);
      else if (element && !element.groupPath.includes(String(candidate.id))) add(path, `element ${id} is not a descendant of group ${String(candidate.id)}`);
    });
  });
  return diagnostics;
}

export class StationaryLayoutError extends Error {
  constructor(readonly diagnostics: ReadonlyArray<StationaryDiagnostic>) { super(`Invalid stationary layout:\n${diagnostics.map(({ path, message }) => `${path}: ${message}`).join("\n")}`); this.name = "StationaryLayoutError"; }
}

export function compileStationaryLayout(value: unknown, customConfigurations: ReadonlyArray<unknown> = []): CompiledStationaryLayout {
  const diagnostics = stationaryLayoutDiagnostics(value, customConfigurations);
  if (diagnostics.length) throw new StationaryLayoutError(diagnostics);
  const layout = value as StationaryLayout;
  const children = new Map<string | null, StationaryGroupPlacement[]>();
  layout.groups.forEach((group) => children.set(group.parentId, [...children.get(group.parentId) ?? [], group]));
  const elements = new Map<string, StationaryElementPlacement[]>();
  layout.elements.forEach((element) => elements.set(element.groupId, [...elements.get(element.groupId) ?? [], element]));
  const build = (group: StationaryGroupPlacement): CompiledStationaryGroup => ({ ...group, elements: elements.get(group.id) ?? [], children: (children.get(group.id) ?? []).map(build) });
  return Object.freeze({ ...layout, hierarchy: (children.get(null) ?? []).map(build) });
}

export const STATIONARY_LAYOUT = source as unknown as StationaryLayout;
export const COMPILED_STATIONARY_LAYOUT = compileStationaryLayout(STATIONARY_LAYOUT);
