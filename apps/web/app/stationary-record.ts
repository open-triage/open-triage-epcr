import type { EncounterDocument, FormDraftDefinition } from "@open-triage/contracts";
import { NEMSIS_DATA_MODEL, getNemsisGroup } from "./nemsis-data-model";
import { COMPILED_STATIONARY_LAYOUT, type CompiledStationaryGroup, type StationaryElementPlacement } from "./stationary-layout";

export type StationarySectionFinding = {
  readonly severity: "error" | "warning";
  readonly message?: string;
  readonly target: {
    readonly groupId: string;
    readonly groupInstanceId?: string;
    readonly instanceId?: string;
    readonly elementId?: string;
    readonly fieldId?: string;
    readonly occurrenceId?: string;
  };
};

export type StationarySectionStatus = {
  readonly errors: number;
  readonly warnings: number;
  readonly incomplete: number;
};

export type StationarySection = {
  readonly id: string;
  readonly hash: string;
  readonly label: string;
  readonly root: CompiledStationaryGroup;
};

export type StationaryRenderBlock = {
  readonly kind: "inline" | "table";
  readonly group: CompiledStationaryGroup;
  readonly elementIds?: ReadonlyArray<string>;
};

export type ConfiguredStationarySection = {
  readonly id: string;
  readonly hash: string;
  readonly label: string;
  readonly blocks: ReadonlyArray<StationaryRenderBlock>;
  readonly fields: FormDraftDefinition["sections"][number]["fields"];
  readonly groupIds: ReadonlySet<string>;
};

const EMPTY_STATUS: StationarySectionStatus = { errors: 0, warnings: 0, incomplete: 0 };
const HIDDEN_STATIONARY_SECTION_IDS = new Set(["DemographicGroup", "eCustomConfigurationSection"]);
const HIDDEN_STATIONARY_ELEMENT_PREFIXES = ["dAgency.", "eCustomConfiguration."] as const;
const layoutGroups = new Map<string, CompiledStationaryGroup>();

function indexGroup(group: CompiledStationaryGroup): void {
  layoutGroups.set(group.id, group);
  group.children.forEach(indexGroup);
}

COMPILED_STATIONARY_LAYOUT.hierarchy.forEach(indexGroup);

const elementGroups = new Map(COMPILED_STATIONARY_LAYOUT.elements.map((element) => [element.id, element.groupId]));

function configuredRoot(groupId: string): { kind: "inline" | "table"; group: CompiledStationaryGroup } | undefined {
  const group = layoutGroups.get(groupId);
  if (!group) return undefined;
  let current: CompiledStationaryGroup | undefined = group;
  let tableRoot: CompiledStationaryGroup | undefined;
  while (current) {
    if (current.id === "HeaderGroup" || current.id === "PatientCareReportGroup") break;
    if (current.presentation.kind === "table") tableRoot = current;
    current = current.parentId ? layoutGroups.get(current.parentId) : undefined;
  }
  return tableRoot ? { kind: "table", group: tableRoot } : { kind: "inline", group };
}

function filteredGroup(group: CompiledStationaryGroup, elementIds: ReadonlyArray<string>): CompiledStationaryGroup | undefined {
  const children = group.children.flatMap((child) => {
    const filtered = filteredGroup(child, elementIds);
    return filtered ? [filtered] : [];
  });
  const elements = elementIds.flatMap((id) => group.elements.find((element) => element.id === id) ?? []);
  if (!elements.length && !children.length) return undefined;
  const descendantIds = new Set<string>();
  const collect = (candidate: CompiledStationaryGroup) => {
    candidate.elements.forEach(({ id }) => descendantIds.add(id));
    candidate.children.forEach(collect);
  };
  elements.forEach(({ id }) => descendantIds.add(id));
  children.forEach(collect);
  const columns = group.presentation.columns?.filter(({ elementId }) => descendantIds.has(elementId));
  return { ...group, presentation: { ...group.presentation, ...(columns ? { columns } : {}) }, elements, children };
}

function presentationText(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

/** Projects an unsaved form draft onto the same group contracts used by Stationary. */
export function configuredStationaryPreviewSections(definition: FormDraftDefinition): ReadonlyArray<ConfiguredStationarySection> {
  return definition.sections.flatMap((section, sectionIndex) => {
    const fields = section.fields.filter((field) => {
      if (field.source.kind !== "nemsis") return true;
      const elementId = field.source.elementId;
      return !HIDDEN_STATIONARY_ELEMENT_PREFIXES.some((prefix) => elementId.startsWith(prefix));
    });
    if (!fields.length) return [];
    const pending: Array<{ kind: "inline" | "table"; group: CompiledStationaryGroup; elementIds: string[] }> = [];
    for (const field of fields) {
      if (field.source.kind !== "nemsis") continue;
      const groupId = elementGroups.get(field.source.elementId);
      const root = groupId ? configuredRoot(groupId) : undefined;
      if (!root) continue;
      const prior = pending.at(-1);
      if (prior?.kind === root.kind && prior.group.id === root.group.id) prior.elementIds.push(field.source.elementId);
      else pending.push({ ...root, elementIds: [field.source.elementId] });
    }
    const blocks = pending.flatMap(({ kind, group, elementIds }) => {
      const filtered = filteredGroup(group, elementIds);
      return filtered ? [{ kind, group: filtered, elementIds } satisfies StationaryRenderBlock] : [];
    });
    const groupIds = new Set(blocks.flatMap(({ group }) => {
      const ids: string[] = [];
      const visit = (candidate: CompiledStationaryGroup) => { ids.push(candidate.id); candidate.children.forEach(visit); };
      visit(group);
      return ids;
    }));
    return [{
      id: `draft-${sectionIndex}-${section.key}`,
      hash: `stationary-preview-section-${sectionIndex}-${section.key.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`,
      label: presentationText(section.presentation, "title") ?? section.key,
      blocks,
      fields,
      groupIds,
    }];
  });
}

/** Stable fragment identifiers derived solely from configured group identities. */
export function stationarySectionHash(groupId: string): string {
  return `stationary-section-${groupId.replaceAll(".", "-")}`;
}

/**
 * The rail represents clinician-facing PCR sections in checked-in configuration
 * order. System-owned demographic and custom-configuration metadata remain in
 * the canonical document but are not presented in the stationary workflow.
 */
export function configuredStationarySections(): ReadonlyArray<StationarySection> {
  const header = layoutGroups.get("HeaderGroup");
  const report = layoutGroups.get("PatientCareReportGroup");
  if (!header || !report) throw new Error("The stationary layout is missing its Header or PatientCareReport boundary");
  const roots = [...header.children.filter(({ id }) => id !== report.id), ...report.children]
    .filter(({ id }) => !HIDDEN_STATIONARY_SECTION_IDS.has(id));
  return roots.map((root) => ({
    id: root.id,
    hash: stationarySectionHash(root.id),
    label: root.presentation.label ?? getNemsisGroup(root.id)?.name ?? root.id,
    root,
  }));
}

/** Inline groups are shown on-page; a table owns presentation of its descendants. */
export function stationarySectionBlocks(section: StationarySection): ReadonlyArray<StationaryRenderBlock> {
  const blocks: StationaryRenderBlock[] = [];
  const visit = (group: CompiledStationaryGroup) => {
    if (group.presentation.kind === "table") {
      blocks.push({ kind: "table", group });
      return;
    }
    blocks.push({ kind: "inline", group });
    group.children.forEach(visit);
  };
  visit(section.root);
  return blocks;
}

export function stationarySectionForGroup(groupId: string, sections: ReadonlyArray<StationarySection> = configuredStationarySections()): StationarySection | undefined {
  const sectionRoots = new Set(sections.map(({ id }) => id));
  let current: string | null = groupId;
  while (current) {
    if (sectionRoots.has(current)) return sections.find(({ id }) => id === current);
    current = getNemsisGroup(current)?.parentId ?? null;
  }
  return undefined;
}

/** Projects validation and catalog-required completeness onto the navigation rail. */
export function stationarySectionStatuses(
  document: EncounterDocument,
  findings: ReadonlyArray<StationarySectionFinding> = [],
  sections: ReadonlyArray<StationarySection> = configuredStationarySections(),
): ReadonlyMap<string, StationarySectionStatus> {
  const statuses = new Map(sections.map(({ id }) => [id, { ...EMPTY_STATUS }]));
  const supplied = new Set(document.groups.flatMap((group) => group.instances.flatMap((instance) =>
    instance.elements.filter(({ values }) => values.length > 0).map(({ id }) => id),
  )));
  for (const element of NEMSIS_DATA_MODEL.elements) {
    if (element.occurrence.min === 0 || supplied.has(element.id)) continue;
    const section = stationarySectionForGroup(element.groupPath.at(-1)!, sections);
    if (!section) continue;
    const status = statuses.get(section.id)!;
    statuses.set(section.id, { ...status, incomplete: status.incomplete + 1 });
  }
  for (const finding of findings) {
    const section = stationarySectionForGroup(finding.target.groupId, sections);
    if (!section) continue;
    const status = statuses.get(section.id)!;
    statuses.set(section.id, {
      ...status,
      [finding.severity === "error" ? "errors" : "warnings"]: status[finding.severity === "error" ? "errors" : "warnings"] + 1,
    });
  }
  return statuses;
}

export type StationaryPresentationCoverage = {
  readonly groups: ReadonlyMap<string, "inline" | "table" | "nested-inline" | "nested-table">;
  readonly elements: ReadonlyMap<string, "editable" | "enhanced" | "read-only">;
};

/** Enumerates the renderer route for every compiled group and element. */
export function stationaryPresentationCoverage(): StationaryPresentationCoverage {
  const groups = new Map<string, "inline" | "table" | "nested-inline" | "nested-table">();
  const elements = new Map<string, StationaryElementPlacement["mode"]>();
  const visit = (group: CompiledStationaryGroup, tableAncestor: boolean) => {
    groups.set(group.id, tableAncestor
      ? group.presentation.kind === "table" ? "nested-table" : "nested-inline"
      : group.presentation.kind);
    group.elements.forEach((element) => elements.set(element.id, element.mode));
    group.children.forEach((child) => visit(child, tableAncestor || group.presentation.kind === "table"));
  };
  COMPILED_STATIONARY_LAYOUT.hierarchy.forEach((group) => visit(group, false));
  return { groups, elements };
}

/** Chooses the last section crossing the sticky-header activation line. */
export function activeStationarySection(
  positions: ReadonlyArray<{ readonly id: string; readonly top: number }>,
  activationTop = 160,
): string | undefined {
  return positions.reduce<string | undefined>((active, position) => position.top <= activationTop ? position.id : active, undefined)
    ?? positions[0]?.id;
}
