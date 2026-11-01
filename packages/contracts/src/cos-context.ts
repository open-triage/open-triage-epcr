/** Local operational assignments never belong in portable clinical mapping packages. */
export interface DestinationEntry {
  id: string; groupId: string; revision: number; localCode: string; displayName: string;
  hsaId: string | null; active: boolean;
}
export interface DestinationSelection {
  directoryId: string; revision: number; displayName: string; localCode: string;
}
export interface SaveDestinationCommand {
  expectedRevision?: number; localCode: string; displayName: string; hsaId: string | null; active: boolean;
}
export interface DestinationPage { items: DestinationEntry[]; nextCursor: string | null; }
/** Both fields remain ordinary NEMSIS strings; changing either invalidates routing provenance. */
export function destinationSelectionMatches(selection: DestinationSelection | null | undefined, name: string, code: string): boolean {
  return !!selection && selection.displayName === name && selection.localCode === code;
}
export function selectDestination(entry: DestinationEntry) {
  return { name: entry.displayName, code: entry.localCode, selection: {
    directoryId: entry.id, revision: entry.revision, displayName: entry.displayName, localCode: entry.localCode
  } satisfies DestinationSelection };
}
export function isDestinationSelection(value: unknown): value is DestinationSelection {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  return Object.keys(row).every(key=>['directoryId','revision','displayName','localCode'].includes(key))
    && typeof row.directoryId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(row.directoryId)
    && Number.isSafeInteger(row.revision)&&Number(row.revision)>0
    && typeof row.displayName==='string'&&row.displayName.length>=2&&row.displayName.length<=100&&!/[\p{Cc}\p{Cf}]/u.test(row.displayName)
    && typeof row.localCode==='string'&&row.localCode.length>=2&&row.localCode.length<=50&&!/[\p{Cc}\p{Cf}]/u.test(row.localCode);
}


/** Explicit no destination uses standard NEMSIS Not Applicable, never a directory entry. */
export const DESTINATION_NONE_CODE = "7701001";
export type DestinationDecisionValue = { text?: string | null; notValueCode?: string | null };
export function destinationDecision(
  names: ReadonlyArray<DestinationDecisionValue>, codes: ReadonlyArray<DestinationDecisionValue>,
): "destination" | "none" | "missing" {
  if (names.length !== 1 || codes.length !== 1) return "missing";
  const name = names[0]!, code = codes[0]!;
  if (name.notValueCode === DESTINATION_NONE_CODE && code.notValueCode === DESTINATION_NONE_CODE
    && !name.text && !code.text) return "none";
  return !name.notValueCode && !code.notValueCode && name.text?.trim() && code.text?.trim()
    ? "destination" : "missing";
}
export function encounterDestinationDecision(instance?: import("./index.js").EncounterGroupInstance) {
  const values = (id: string) => (instance?.elements.find(element => element.id === id)?.values ?? []).map(value => ({
    text: value.kind === "scalar" ? String(value.lexical ?? value.value) : undefined,
    notValueCode: value.notValue?.code,
  }));
  return destinationDecision(values("eDisposition.01"), values("eDisposition.02"));
}
