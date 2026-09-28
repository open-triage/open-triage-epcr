import { stationarySectionForGroup } from "./stationary-record";
import { stationaryDisplayLabel } from "./stationary-label";

/** Group findings without discarding their stable identity or correction targets. */
export function groupReviewFindings<T extends { readonly target: { readonly groupId: string } }>(findings: ReadonlyArray<T>):
  ReadonlyArray<{ label: string; findings: T[] }> {
  const sections = new Map<string, T[]>();
  for (const finding of findings) {
    const section = stationarySectionForGroup(finding.target.groupId);
    const label = section ? stationaryDisplayLabel(section.label) : "Other record fields";
    const existing = sections.get(label);
    if (existing) existing.push(finding);
    else sections.set(label, [finding]);
  }
  return [...sections].map(([label, entries]) => ({ label, findings: entries }));
}
