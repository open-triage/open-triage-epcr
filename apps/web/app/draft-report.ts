import { platformRequestError } from "./platform-errors";
import type { ActiveReportResource, ClinicalFormConfiguration, CreateReportTextNoteCommand, DeleteDraftReportResponse, DeleteReportTextNoteCommand, DeleteReportTextNoteResponse, DispatchCancellation, DispatchConflict, DispatchPriority, EncounterDocument, EncounterValue, ReportMediaPolicy, ReportNote, ReportTextNoteMutationResponse, UpdateReportTextNoteCommand } from "@open-triage/contracts";
import type { ShellState } from "./standard-encounter";
import { getNemsisGroup, requireNemsisDataElement } from "./nemsis-data-model";
import { DEMO_GROUP_CORRELATION_PREFIX, DEMO_PROVENANCE_VALUE, hasDemoProvenance } from "./demo-provenance";
import {
  apiRequestUrl,
  browserRequestConfiguration,
  browserRequestInit,
  browserRouteUrl,
} from "./browser-api";

export const DRAFT_SAVE_DEBOUNCE_MS = 1_000;
export const DRAFT_SYNC_RETRY_MS = 2_000;
export const ACTIVE_REPORT_POLL_INTERVAL_MS = 10_000;
export const DRAFT_CONFLICT_RECOVERY_LIMIT = 1;
export type DraftSyncStatus = "Saved" | "Saving" | "Pending sync" | "Conflict";

export function reconciledDraftSyncStatus(current: DraftSyncStatus, hasPendingChanges: boolean): DraftSyncStatus {
  return hasPendingChanges ? current : "Saved";
}

export type DraftSaveFailureCategory = "server-conflict" | "validation-rejected";

/** A bounded, value-free failure classification safe to include in diagnostics. */
export class DraftSaveRejectedError extends Error {
  constructor(readonly category: DraftSaveFailureCategory) {
    super(category);
    this.name = "DraftSaveRejectedError";
  }
}

export function shouldQueueInitialDraftSnapshot(
  localStateStatus: "empty" | "restored" | "incompatible" | "invalid",
  serverRevision: number,
  hasServerDocument: boolean,
  hasQueuedChange: boolean,
): boolean {
  return localStateStatus === "empty" && serverRevision === 0 && hasServerDocument && !hasQueuedChange;
}

export interface ActiveDraftReport {
  readonly id: string;
  readonly revision: number;
  readonly formVersionId: string;
  readonly callNumber?: string;
  readonly dispatchedAt?: string;
  readonly dispatchReason?: string | null;
  readonly dispatchPriority?: DispatchPriority | null;
  readonly chiefComplaint?: string | null;
  readonly unitCallSign?: string;
  readonly agencyTimeZone?: string;
  readonly documentingUserId?: string;
  readonly catalogReleaseId?: string;
  readonly validationVersionId?: string;
  readonly formDefinitionSha256?: string;
  readonly catalogArtifactSha256?: string;
  readonly validationCompiledSha256?: string;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly status?: "draft";
  readonly demoMutable?: boolean;
  readonly expiresAt?: string;
  readonly document?: EncounterDocument;
  readonly notes?: ReadonlyArray<ReportNote>;
  readonly mediaPolicy?: ReportMediaPolicy;
  readonly dispatchConflicts?: ReadonlyArray<DispatchConflict>;
  readonly dispatchCancellation?: DispatchCancellation | null;
}

export function dispatchCancellationNotice(cancellation: DispatchCancellation): string {
  return `Your report is preserved. Continue documentation as needed; cancellation received ${new Date(cancellation.canceledAt).toLocaleString()}.`;
}

export interface DraftGroupMutation {
  readonly id: string;
  readonly groupId: string;
  readonly parentGroupInstanceId?: string | null;
  readonly ordinal: number;
  readonly documentedTime?: string;
  readonly correlationId?: string;
  readonly tombstone?: boolean;
}

export type DraftValue = ({
  readonly notValue?: { readonly code: string; readonly display?: string };
  readonly pertinentNegative?: { readonly code: string; readonly display?: string };
} & (
  | { readonly kind: "text" | "uri"; readonly value: string }
  | { readonly kind: "integer" | "numeric"; readonly value: string | number; readonly lexical?: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "date"; readonly value: string; readonly precision?: string }
  | { readonly kind: "datetime" | "time"; readonly value: string; readonly utcOffsetMinutes?: number; readonly precision?: string }
  | { readonly kind: "duration"; readonly value: string; readonly lexical?: string }
  | { readonly kind: "binary"; readonly value: string }
  | { readonly kind: "coded"; readonly code: string; readonly codeSystem?: string; readonly display?: string; readonly terminologyVersion?: string }
  | { readonly kind: "null" | "pertinent-negative"; readonly absenceCode: string; readonly display?: string }
  | { readonly kind: "absent"; readonly absenceCode?: string; readonly display?: string }
));

export interface DraftOccurrenceMutation {
  readonly id: string;
  readonly elementId: string;
  readonly groupInstanceId: string;
  readonly ordinal: number;
  readonly sourceAttributes?: Record<string, unknown>;
  readonly provenanceKind?: string;
  readonly provenanceDetail?: Record<string, unknown>;
  readonly tombstone?: boolean;
  readonly value?: DraftValue;
}

export interface SaveDraftReportCommand {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly authorId: string;
  readonly deviceId: string;
  readonly clientTime: string;
  readonly demoAction?: "populate" | "clear";
  readonly groups: ReadonlyArray<DraftGroupMutation>;
  readonly occurrences: ReadonlyArray<DraftOccurrenceMutation>;
}

export interface SavedDraftReport { readonly id: string; readonly revision: number; readonly status: "draft" }
export interface RetainedSignedDraftAttempt { readonly id: string; readonly revision: number; readonly status: "signed" }

/** Produces an RFC-4122-shaped, deterministic identity for a local report entity. */
export function stableDraftId(reportId: string, localId: string): string {
  const hash = (seed: number) => {
    let value = seed;
    for (const character of `${reportId}:${localId}`) value = Math.imul(value ^ character.charCodeAt(0), 16_777_619);
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  const hex = `${hash(2_166_136_261)}${hash(2_166_136_262)}${hash(2_166_136_263)}${hash(2_166_136_264)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const persistedDraftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function draftTargetId(reportId: string, targetKind: "group" | "occurrence", identity: string): string {
  return persistedDraftIdPattern.test(identity) ? identity : stableDraftId(reportId, `${targetKind}:${identity}`);
}

function draftValue(elementId: string, value: EncounterValue): DraftValue {
  const metadata: Pick<DraftValue, "notValue" | "pertinentNegative"> = {
    ...(value.notValue ? { notValue: value.notValue } : {}),
    ...(value.pertinentNegative ? { pertinentNegative: value.pertinentNegative } : {}),
  };
  if (value.kind === "coded") return { kind: "coded", code: value.code, ...(value.system ? { codeSystem: value.system } : {}), ...(value.display ? { display: value.display } : {}), ...(typeof value.terminologyVersion === "string" ? { terminologyVersion: value.terminologyVersion } : {}), ...metadata };
  if (value.kind === "pertinent-negative") return { kind: "pertinent-negative", absenceCode: value.code, ...(value.display ? { display: value.display } : {}), ...metadata };
  if (value.kind === "null") return value.notValue
    ? { kind: "null", absenceCode: value.notValue.code, ...(value.notValue.display ? { display: value.notValue.display } : {}), ...metadata }
    : { kind: "absent", ...metadata };
  if (value.kind === "absent") return { kind: "absent", ...metadata };
  const base = requireNemsisDataElement(elementId).datatype.base;
  if (base === "integer") {
    const scalar = typeof value.value === "boolean" ? Number(value.value) : value.value;
    const numeric = Number(scalar);
    return { kind: "integer", value: Number.isInteger(numeric) ? numeric : scalar,
      ...(typeof value.lexical === "string" ? { lexical: value.lexical } : {}), ...metadata };
  }
  if (["decimal", "double", "float"].includes(base)) {
    const scalar = typeof value.value === "boolean" ? Number(value.value) : value.value;
    const numeric = Number(scalar);
    return { kind: "numeric", value: Number.isFinite(numeric) ? numeric : scalar,
      ...(typeof value.lexical === "string" ? { lexical: value.lexical } : {}), ...metadata };
  }
  if (base === "boolean") return { kind: "boolean", value: Boolean(value.value), ...metadata };
  if (base === "date") return { kind: "date", value: String(value.value), ...(typeof value.precision === "string" ? { precision: value.precision } : {}), ...metadata };
  if (base === "dateTime") return { kind: "datetime", value: String(value.value), ...(typeof value.utcOffsetMinutes === "number" ? { utcOffsetMinutes: value.utcOffsetMinutes } : {}), ...(typeof value.precision === "string" ? { precision: value.precision } : {}), ...metadata };
  if (base === "time") return { kind: "time", value: String(value.value), ...(typeof value.utcOffsetMinutes === "number" ? { utcOffsetMinutes: value.utcOffsetMinutes } : {}), ...(typeof value.precision === "string" ? { precision: value.precision } : {}), ...metadata };
  if (base === "duration") return { kind: "duration", value: String(value.value), ...(typeof value.lexical === "string" ? { lexical: value.lexical } : {}), ...metadata };
  if (base === "anyURI") return { kind: "uri", value: String(value.value), ...metadata };
  if (base === "binary" || base === "base64Binary" || base === "hexBinary") return { kind: "binary", value: String(value.value), ...metadata };
  return { kind: "text", value: String(value.value), ...metadata };
}

export function encounterDocumentToDraftMutations(
  reportId: string,
  document: EncounterDocument,
  persisted?: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  const instances = new Map(document.groups.flatMap((group) => group.instances.map((instance) => [`${group.id}:${instance.instanceId}`, instance] as const)));
  const groupTargetIds = new Map(document.groups.flatMap((group) => group.instances.map((instance) => [
    instance.instanceId,
    draftTargetId(reportId, "group", instance.instanceId),
  ] as const)));
  const groups: DraftGroupMutation[] = [];
  const occurrences: DraftOccurrenceMutation[] = [];
  document.groups.forEach((group) => {
    if (!getNemsisGroup(group.id)) return; // Custom fields require their pinned form-field identities.
    group.instances.forEach((instance, ordinal) => {
      const parentGroupId = getNemsisGroup(group.id)?.parentId;
      const parentCandidates = parentGroupId ? [...instances.entries()].filter(([key]) => key.startsWith(`${parentGroupId}:`)).map(([, candidate]) => candidate) : [];
      const parent = parentCandidates.find((candidate) => candidate.instanceId === instance.parentInstanceId)
        ?? parentCandidates.find((candidate) => candidate.instanceId === instance.instanceId || instance.instanceId.startsWith(`${candidate.instanceId}:`))
        ?? parentCandidates[0];
      const groupInstanceId = groupTargetIds.get(instance.instanceId)!;
      const documentedTime = typeof instance.attributes?.documentedTime === "string" ? instance.attributes.documentedTime : undefined;
      groups.push({ id: groupInstanceId, groupId: group.id, ordinal, ...(parent ? { parentGroupInstanceId: groupTargetIds.get(parent.instanceId)! } : {}), ...(documentedTime ? { documentedTime } : {}),
        ...(hasDemoProvenance(instance.attributes) ? { correlationId: `${DEMO_GROUP_CORRELATION_PREFIX}${instance.instanceId}` } : {}) });
      instance.elements.forEach((element) => element.values.forEach((value, valueOrdinal) => {
        occurrences.push({
          id: draftTargetId(reportId, "occurrence", value.occurrenceId), elementId: element.id,
          groupInstanceId, ordinal: valueOrdinal, ...(value.attributes ? { sourceAttributes: value.attributes } : {}),
          ...(hasDemoProvenance(value.attributes) ? { provenanceKind: "demo", provenanceDetail: { generator: DEMO_PROVENANCE_VALUE } } : {}),
          value: draftValue(element.id, value),
        });
      }));
    });
  });
  const activeGroupIds = new Set(groups.map(({ id }) => id));
  const activeOccurrenceIds = new Set(occurrences.map(({ id }) => id));
  for (const group of persisted?.groups ?? []) {
    if (!group.tombstone && !activeGroupIds.has(group.id)) groups.push({ ...group, tombstone: true });
  }
  for (const occurrence of persisted?.occurrences ?? []) {
    if (occurrence.tombstone || activeOccurrenceIds.has(occurrence.id)) continue;
    occurrences.push({
      id: occurrence.id,
      elementId: occurrence.elementId,
      groupInstanceId: occurrence.groupInstanceId,
      ordinal: occurrence.ordinal,
      tombstone: true,
    });
  }
  return { groups, occurrences };
}

export function shellStateToDraftMutations(
  reportId: string,
  shell: ShellState,
  persisted?: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  return encounterDocumentToDraftMutations(reportId, shell.encounter.document, persisted);
}

/** Reduces a canonical document projection to only targets changed from its last accepted projection. */
export function draftMutationDelta(
  current: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
  baseline: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  const baselineGroups = new Map(baseline.groups.map((group) => [group.id, group]));
  const baselineOccurrences = new Map(baseline.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  return {
    groups: current.groups.filter((group) => JSON.stringify(group) !== JSON.stringify(baselineGroups.get(group.id))),
    occurrences: current.occurrences.filter((occurrence) => JSON.stringify(occurrence) !== JSON.stringify(baselineOccurrences.get(occurrence.id))),
  };
}

/** Keeps privileged demo commands ownership-pure at the browser/API boundary. */
export function demoActionMutationDelta(
  action: "populate" | "clear",
  mutations: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
  persisted: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  if (action === "populate") {
    return {
      groups: mutations.groups.filter((group) => !group.tombstone && group.correlationId?.startsWith(DEMO_GROUP_CORRELATION_PREFIX)),
      occurrences: mutations.occurrences.filter((occurrence) => !occurrence.tombstone &&
        occurrence.provenanceKind === "demo" &&
        occurrence.provenanceDetail?.generator === DEMO_PROVENANCE_VALUE &&
        occurrence.sourceAttributes?.["x-open-triage-demo"] === DEMO_PROVENANCE_VALUE),
    };
  }
  const demoGroupIds = new Set(persisted.groups
    .filter((group) => group.correlationId?.startsWith(DEMO_GROUP_CORRELATION_PREFIX))
    .map(({ id }) => id));
  const demoOccurrenceIds = new Set(persisted.occurrences
    .filter((occurrence) => occurrence.provenanceKind === "demo" && occurrence.provenanceDetail?.generator === DEMO_PROVENANCE_VALUE)
    .map(({ id }) => id));
  return {
    groups: mutations.groups.filter((group) => group.tombstone && demoGroupIds.has(group.id)),
    occurrences: mutations.occurrences.filter((occurrence) => occurrence.tombstone && demoOccurrenceIds.has(occurrence.id)),
  };
}

/** Recover a mixed optimistic snapshot without relabeling clinician work as demo data. */
export function recoveryMutationBatches(
  mutations: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
  persisted: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): ReadonlyArray<Pick<SaveDraftReportCommand, "groups" | "occurrences" | "demoAction">> {
  const populate = demoActionMutationDelta("populate", mutations, persisted);
  const clear = demoActionMutationDelta("clear", mutations, persisted);
  const demoGroups = new Set([...populate.groups, ...clear.groups].map(({ id }) => id));
  const demoOccurrences = new Set([...populate.occurrences, ...clear.occurrences].map(({ id }) => id));
  // Pending manual groups must reach the server before Populate's dependent values.
  return [
    { groups: mutations.groups.filter(({ id }) => !demoGroups.has(id)),
      occurrences: mutations.occurrences.filter(({ id }) => !demoOccurrences.has(id)) },
    { ...populate, demoAction: "populate" as const },
    { ...clear, demoAction: "clear" as const },
  ].filter(({ groups, occurrences }) => groups.length || occurrences.length);
}

/** Advances an accepted full baseline by one target-level mutation set. */
export function applyDraftMutationDelta(
  baseline: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
  delta: Pick<SaveDraftReportCommand, "groups" | "occurrences">,
): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  const groups = new Map(baseline.groups.map((group) => [group.id, group]));
  const occurrences = new Map(baseline.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  for (const group of delta.groups) {
    if (group.tombstone) groups.delete(group.id);
    else groups.set(group.id, group);
  }
  for (const occurrence of delta.occurrences) {
    if (occurrence.tombstone) occurrences.delete(occurrence.id);
    else occurrences.set(occurrence.id, occurrence);
  }
  return { groups: [...groups.values()], occurrences: [...occurrences.values()] };
}

export function draftChangesUrl(reportId: string): string {
  return browserRouteUrl(`/api/reports/${reportId}/draft-changes`);
}

export async function saveDraftReport(csrfToken: string, reportId: string, command: SaveDraftReportCommand): Promise<SavedDraftReport | RetainedSignedDraftAttempt> {
  // The static prototype's durable browser cache is its only backing store. A
  // successful local write is therefore synchronized; no nonexistent HTTP API
  // should leave the browser-only workflow permanently pending.
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    return { id: reportId, status: "draft", revision: command.expectedRevision + 1 };
  }
  let response: Response;
  try {
    response = await fetch(draftChangesUrl(reportId), browserRequestInit({ method: "POST", headers: { "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify(command) }));
  } catch {
    throw new Error("offline");
  }
  if (response.status === 409) throw new DraftSaveRejectedError("server-conflict");
  if (response.status === 422) throw new DraftSaveRejectedError("validation-rejected");
  if (response.status === 410) throw new Error("purged");
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "offline");
  return response.json() as Promise<SavedDraftReport | RetainedSignedDraftAttempt>;
}

export async function deleteDraftReport(csrfToken: string, reportId: string): Promise<DeleteDraftReportResponse> {
  const url = apiRequestUrl(`/api/reports/${reportId}`);
  if (!url) throw new Error("Record deletion requires the database-backed prototype.");
  let response: Response;
  try {
    response = await fetch(url, browserRequestInit({
      method: "DELETE", headers: { "x-csrf-token": csrfToken },
    }));
  } catch {
    throw new Error("Record deletion is unavailable while offline.");
  }
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<DeleteDraftReportResponse>;
}

async function mutateReportTextNote<T>(csrfToken: string, path: string, method: "POST" | "DELETE", body: unknown): Promise<T> {
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    throw new Error("Text notes require the database-backed application.");
  }
  let response: Response;
  try {
    response = await fetch(browserRouteUrl(path, configuration), browserRequestInit({
      method,
      headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  } catch {
    throw new Error("The text note could not be saved. Check your connection and try again.");
  }
  if (response.status === 409) throw new DraftSaveRejectedError("server-conflict");
  if (response.status === 422) throw new DraftSaveRejectedError("validation-rejected");
  if (response.status === 401) throw new Error("session");
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<T>;
}

export function createReportTextNote(csrfToken: string, reportId: string, command: CreateReportTextNoteCommand): Promise<ReportTextNoteMutationResponse> {
  return mutateReportTextNote(csrfToken, `/api/reports/${reportId}/notes`, "POST", command);
}

export function updateReportTextNote(csrfToken: string, reportId: string, noteId: string, command: UpdateReportTextNoteCommand): Promise<ReportTextNoteMutationResponse> {
  return mutateReportTextNote(csrfToken, `/api/reports/${reportId}/notes/${noteId}`, "POST", command);
}

export function deleteReportTextNote(csrfToken: string, reportId: string, noteId: string, command: DeleteReportTextNoteCommand): Promise<DeleteReportTextNoteResponse> {
  return mutateReportTextNote(csrfToken, `/api/reports/${reportId}/notes/${noteId}`, "DELETE", command);
}

export async function fetchActiveReport(
  reportId: string,
  etag?: string,
): Promise<{ readonly etag: string; readonly resource: ActiveReportResource } | null> {
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) return null;
  const url = browserRouteUrl(`/api/reports/${reportId}/active`, configuration);
  let response: Response;
  try {
    response = await fetch(url, browserRequestInit({
      headers: { ...(etag ? { "if-none-match": etag } : {}) },
    }));
  } catch {
    throw new Error("offline");
  }
  if (response.status === 304) return null;
  if (response.status === 410) throw new Error("purged");
  if (response.status === 404) throw new Error("completed");
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "offline");
  return { etag: response.headers.get("etag") ?? "", resource: await response.json() as ActiveReportResource };
}

export async function signDraftReport(
  csrfToken: string,
  reportId: string,
  expectedRevision: number,
  signerId: string,
  warningAcknowledgements: ReadonlyArray<string | { readonly id: string; readonly acknowledgement?: {
    readonly validationVersionId: string;
    readonly ruleId: string;
    readonly targetElementId: string;
    readonly targetGroupInstanceId?: string;
    readonly targetOccurrenceId?: string;
    readonly inputFingerprint: string;
  } }>,
  evaluationTimestamp = new Date().toISOString(),
): Promise<void> {
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) return;
  const path = `/api/reports/${reportId}/sign`;
  let response: Response;
  try {
    response = await fetch(browserRouteUrl(path, configuration), browserRequestInit({
      method: "POST",
      headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision,
        signerId,
        attestation: { meaning: "clinician approval" },
        warningAcknowledgements: Object.fromEntries(warningAcknowledgements.map((item) => typeof item === "string"
          ? [item, true] : [item.id, item.acknowledgement ?? true])),
        deviceId: `web:${reportId}`,
        clientTime: evaluationTimestamp,
      }),
    }));
  } catch {
    throw new Error("The record could not be signed. Check your connection and try again.");
  }
  if (!response.ok) throw await platformRequestError(response);
}
