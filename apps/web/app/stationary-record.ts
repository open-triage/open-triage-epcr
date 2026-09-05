import type { EncounterDocument } from "@open-triage/contracts";
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
};

const EMPTY_STATUS: StationarySectionStatus = { errors: 0, warnings: 0, incomplete: 0 };
const layoutGroups = new Map<string, CompiledStationaryGroup>();

function indexGroup(group: CompiledStationaryGroup): void {
  layoutGroups.set(group.id, group);
  group.children.forEach(indexGroup);
}

COMPILED_STATIONARY_LAYOUT.hierarchy.forEach(indexGroup);

/** Stable fragment identifiers derived solely from configured group identities. */
export function stationarySectionHash(groupId: string): string {
  return `stationary-section-${groupId.replaceAll(".", "-")}`;
}

/**
 * The rail represents the two Header payload sections followed by every PCR
 * section, preserving their checked-in configuration order.
 */
export function configuredStationarySections(): ReadonlyArray<StationarySection> {
  const header = layoutGroups.get("HeaderGroup");
  const report = layoutGroups.get("PatientCareReportGroup");
  if (!header || !report) throw new Error("The stationary layout is missing its Header or PatientCareReport boundary");
  const roots = [...header.children.filter(({ id }) => id !== report.id), ...report.children];
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
