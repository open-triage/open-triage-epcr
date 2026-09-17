import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import type { EncounterDefinition } from "./encounter-definition";
import { EncounterDocumentError, loadEncounterDocument, normalizeEmptyEncounterElements } from "./encounter-document";
import { saveCanonicalEvent } from "./canonical-events";
import { DEMO_FALLBACK_DATE } from "./demo-provenance";
import { bundledEncounterDefinition, type EncounterEvent, type ShellState } from "./standard-encounter";

export const STORAGE_KEY = "open-triage:standard-encounter-v1";
export const REPORT_SYNC_STORAGE_PREFIX = "open-triage:report-sync-v1";
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}:recovery`;
export const LEGACY_STORAGE_KEYS = ["open-triage:adult-chest-pain-v2"] as const;
export const PERSISTENCE_VERSION = 5 as const;
export const PREVIOUS_PERSISTENCE_VERSION = 4 as const;
export const ENCOUNTER_EXTENSION_KEY = "x-open-triage-standard-form" as const;
export const ENCOUNTER_EXTENSION_VERSION = "1.0.0" as const;

export function reportStorageKey(reportId?: string): string {
  return reportId ? `${STORAGE_KEY}:report:${reportId}` : STORAGE_KEY;
}

export function reportSyncStorageKey(reportId: string): string {
  return `${REPORT_SYNC_STORAGE_PREFIX}:${reportId}`;
}

export function saveReportSyncStatus(storage: LocalStoragePort, reportId: string, status: "Saved" | "Saving" | "Pending sync" | "Conflict"): void {
  storage.setItem(reportSyncStorageKey(reportId), status);
}

export type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PersistedFormProfile {
  readonly id: string;
  readonly version: string;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
}

export type ShellStateLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly reason: string; readonly recoveryKey: typeof RECOVERY_STORAGE_KEY }
  | { readonly status: "incompatible"; readonly savedDefinition: { readonly id: string | null; readonly version: number | null }; readonly expectedDefinition: { readonly id: string; readonly version: number }; readonly recoveryKey: typeof RECOVERY_STORAGE_KEY }
  | { readonly status: "restored"; readonly state: ShellState; readonly migrated: boolean };

export function saveShellState(storage: LocalStoragePort, state: ShellState, reportId?: string): void {
  const normalized = normalizeEmptyEncounterElements(state.encounter.document).document as ShellState["encounter"]["document"];
  const document = {
    ...normalized,
    [ENCOUNTER_EXTENSION_KEY]: {
      version: ENCOUNTER_EXTENSION_VERSION,
      acknowledgedWarnings: state.acknowledgedWarnings,
      ...(state.encounter.customData ? { customData: state.encounter.customData } : {}),
    },
  };
  storage.setItem(reportStorageKey(reportId), JSON.stringify({
    persistenceVersion: PERSISTENCE_VERSION,
    document,
    workflow: {
      view: state.view,
      noteDraft: state.noteDraft,
      procedureDraft: state.procedureDraft,
      vitalDraft: state.vitalDraft,
      medicationDraft: state.medicationDraft,
    },
  }));
}

function preserveForRecovery(storage: LocalStoragePort, serialized: string, sourceKey = STORAGE_KEY): typeof RECOVERY_STORAGE_KEY {
  storage.setItem(RECOVERY_STORAGE_KEY, serialized);
  storage.removeItem(sourceKey);
  return RECOVERY_STORAGE_KEY;
}

export function loadShellStateResult(
  storage: LocalStoragePort,
  definition: EncounterDefinition = bundledEncounterDefinition,
  reportId?: string,
  expectedFormProfile?: PersistedFormProfile,
): ShellStateLoadResult {
  const key = reportStorageKey(reportId);
  const serialized = storage.getItem(key);
  if (serialized === null) {
    if (reportId) return { status: "empty" };
    const legacyKey = LEGACY_STORAGE_KEYS.find((key) => storage.getItem(key) !== null);
    if (!legacyKey) return { status: "empty" };
    const legacySerialized = storage.getItem(legacyKey)!;
    let savedDefinition: { id: string | null; version: number | null } = { id: null, version: null };
    try {
      const legacy = JSON.parse(legacySerialized) as { encounter?: { definitionId?: unknown; definitionVersion?: unknown } };
      savedDefinition = {
        id: typeof legacy.encounter?.definitionId === "string" ? legacy.encounter.definitionId : null,
        version: Number.isInteger(legacy.encounter?.definitionVersion) ? legacy.encounter!.definitionVersion as number : null,
      };
    } catch { /* The original bytes are still recoverable below. */ }
    return {
      status: "incompatible",
      savedDefinition,
      expectedDefinition: { id: definition.id, version: definition.version },
      recoveryKey: preserveForRecovery(storage, legacySerialized, legacyKey),
    };
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") return { status: "invalid", reason: "saved state must be an object", recoveryKey: preserveForRecovery(storage, serialized, key) };
    const record = parsed as Record<string, unknown>;
    const isCurrentEnvelope = record.persistenceVersion === PERSISTENCE_VERSION && record.document && typeof record.document === "object" && record.workflow && typeof record.workflow === "object";
    const isPreviousEnvelope = record.persistenceVersion === PREVIOUS_PERSISTENCE_VERSION && record.document && typeof record.document === "object" && record.workflow && typeof record.workflow === "object";
    if (!isCurrentEnvelope && !isPreviousEnvelope) {
      return { status: "invalid", reason: `saved persistence version ${String(record.persistenceVersion)} is not supported`, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    let currentDocument = record.document as Record<string, unknown>;
    const candidate = record.workflow as Partial<ShellState>;
    const extension = currentDocument?.[ENCOUNTER_EXTENSION_KEY] as Record<string, unknown> | undefined;
    if (!extension || extension.version !== ENCOUNTER_EXTENSION_VERSION) {
      return { status: "invalid", reason: `saved extension version ${String(extension?.version)} is not supported`, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    const savedDefinition = {
      id: (currentDocument.formProfile as Record<string, unknown> | undefined)?.id as string ?? null,
      version: Number((currentDocument.formProfile as Record<string, unknown> | undefined)?.version) || null,
    };
    const pinnedProfile = expectedFormProfile ?? { id: definition.id, version: String(definition.version) };
    const expectedDefinition = { id: pinnedProfile.id, version: Number(pinnedProfile.version) };
    if (savedDefinition.id !== expectedDefinition.id || savedDefinition.version !== expectedDefinition.version) {
      return { status: "incompatible", savedDefinition, expectedDefinition, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    if (!candidate.view || !["timeline", "checklist", "review"].includes(candidate.view)) return { status: "invalid", reason: "saved view is not supported", recoveryKey: preserveForRecovery(storage, serialized, key) };
    const persistedEvents = isPreviousEnvelope ? extension.events : [];
    if (!Array.isArray(persistedEvents)) return { status: "invalid", reason: "saved encounter events must be an array", recoveryKey: preserveForRecovery(storage, serialized, key) };
    if (candidate.noteDraft !== null && candidate.noteDraft !== undefined && typeof candidate.noteDraft.summary !== "string") return { status: "invalid", reason: "saved note draft is invalid", recoveryKey: preserveForRecovery(storage, serialized, key) };
    if (candidate.medicationDraft !== null && candidate.medicationDraft !== undefined && typeof candidate.medicationDraft.label !== "string") return { status: "invalid", reason: "saved medication draft is invalid", recoveryKey: preserveForRecovery(storage, serialized, key) };

    const normalization = reportId ? normalizeEmptyEncounterElements(currentDocument) : { document: currentDocument, removedEmptyElementCount: 0 };
    currentDocument = normalization.document as Record<string, unknown>;
    const migrated = !isCurrentEnvelope || normalization.removedEmptyElementCount > 0;
    let document = loadEncounterDocument(currentDocument, {
      formProfiles: { [pinnedProfile.id]: [pinnedProfile.version] },
      catalogFields: pinnedProfile.catalogFields,
    });
    const baselineIds = new Set(["baseline-1", "baseline-2", "baseline-3", "baseline-4"]);
    if (persistedEvents.some((event) => baselineIds.has(event.id))) {
      throw new Error("saved state contains parallel legacy incident timeline data");
    }
    for (const event of persistedEvents.filter((event) => !baselineIds.has(event.id))) {
      document = saveCanonicalEvent(document, { ...event, date: event.date ?? DEMO_FALLBACK_DATE } as EncounterEvent, definition);
    }
    const state = {
      ...candidate,
      encounter: {
        definitionId: definition.id,
        definitionVersion: definition.version,
        synthetic: true,
        ...(extension.customData ? { customData: extension.customData } : {}),
        document,
      },
      noteDraft: candidate.noteDraft ? { ...candidate.noteDraft, date: candidate.noteDraft.date ?? DEMO_FALLBACK_DATE } : null,
      procedureDraft: candidate.procedureDraft ? { ...candidate.procedureDraft, date: candidate.procedureDraft.date ?? DEMO_FALLBACK_DATE } : null,
      vitalDraft: candidate.vitalDraft ? { ...candidate.vitalDraft, date: candidate.vitalDraft.date ?? DEMO_FALLBACK_DATE, values: { ...candidate.vitalDraft.values, nullValues: candidate.vitalDraft.values.nullValues ?? {} } } : null,
      medicationDraft: candidate.medicationDraft ? { ...candidate.medicationDraft, date: candidate.medicationDraft.date ?? DEMO_FALLBACK_DATE } : null,
      acknowledgedWarnings: Array.isArray(extension.acknowledgedWarnings) ? extension.acknowledgedWarnings : [],
    } as unknown as ShellState;
    return { status: "restored", state, migrated };
  } catch (error) {
    const reason = error instanceof EncounterDocumentError || (error instanceof Error && !(error instanceof SyntaxError)) ? error.message : "saved state is not valid JSON";
    return { status: "invalid", reason, recoveryKey: preserveForRecovery(storage, serialized, key) };
  }
}

export function loadShellState(
  storage: LocalStoragePort,
  definition: EncounterDefinition = bundledEncounterDefinition,
  reportId?: string,
  expectedFormProfile?: PersistedFormProfile,
): ShellState | null {
  const result = loadShellStateResult(storage, definition, reportId, expectedFormProfile);
  return result.status === "restored" ? result.state : null;
}

export function clearShellState(storage: LocalStoragePort, reportId?: string): void {
  storage.removeItem(reportStorageKey(reportId));
  if (reportId) storage.removeItem(reportSyncStorageKey(reportId));
  storage.removeItem(RECOVERY_STORAGE_KEY);
  LEGACY_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

/** Removes only report-scoped state confirmed complete by the server. */
export function purgeCompletedReportCaches(storage: LocalStoragePort, reportIds: ReadonlyArray<string>): void {
  reportIds.forEach((reportId) => {
    const syncKey = reportSyncStorageKey(reportId);
    const status = storage.getItem(syncKey);
    if (status && status !== "Saved") return;
    storage.removeItem(reportStorageKey(reportId));
    storage.removeItem(syncKey);
  });
}
