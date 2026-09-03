import type { EncounterDefinition } from "./encounter-definition";
import { EncounterDocumentError, loadEncounterDocument } from "./encounter-document";
import { patientDraftFromDocument, updatePatientDocument, type PatientChoice, type PatientDraft } from "./patient-document";
import { migrateLegacyIncidentDocument } from "./incident-document";
import { bundledEncounterDefinition, createInitialShellState, type ShellState } from "./standard-encounter";

export const STORAGE_KEY = "open-triage:standard-encounter-v1";
export const REPORT_SYNC_STORAGE_PREFIX = "open-triage:report-sync-v1";
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}:recovery`;
export const LEGACY_STORAGE_KEYS = ["open-triage:adult-chest-pain-v2"] as const;
export const PERSISTENCE_VERSION = 4 as const;
const LEGACY_PERSISTENCE_VERSIONS = [2, 3] as const;
export const ENCOUNTER_EXTENSION_KEY = "x-open-triage-standard-form" as const;
export const ENCOUNTER_EXTENSION_VERSION = "1.0.0" as const;

export function reportStorageKey(reportId?: string): string {
  return reportId ? `${STORAGE_KEY}:report:${reportId}` : STORAGE_KEY;
}

export function reportSyncStorageKey(reportId: string): string {
  return `${REPORT_SYNC_STORAGE_PREFIX}:${reportId}`;
}

export function saveReportSyncStatus(storage: LocalStoragePort, reportId: string, status: "Saved" | "Saving" | "Offline" | "Conflict"): void {
  storage.setItem(reportSyncStorageKey(reportId), status);
}

export type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ShellStateLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly reason: string; readonly recoveryKey: typeof RECOVERY_STORAGE_KEY }
  | { readonly status: "incompatible"; readonly savedDefinition: { readonly id: string | null; readonly version: number | null }; readonly expectedDefinition: { readonly id: string; readonly version: number }; readonly recoveryKey: typeof RECOVERY_STORAGE_KEY }
  | { readonly status: "restored"; readonly state: ShellState; readonly migrated: boolean };

export function saveShellState(storage: LocalStoragePort, state: ShellState, reportId?: string): void {
  const document = {
    ...state.encounter.document,
    [ENCOUNTER_EXTENSION_KEY]: {
      version: ENCOUNTER_EXTENSION_VERSION,
      events: state.encounter.events,
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

function legacyChoice(kind: PatientChoice["kind"], code: string, label: string, system?: string): PatientChoice {
  return { kind, code, label, ...(system ? { system } : {}) };
}

function migrateLegacyPatient(patient: Record<string, unknown>, baseline: PatientDraft): PatientDraft {
  const history = new Map<string, PatientChoice>([
    ["Hypertension", legacyChoice("coded", "I10", "Hypertension", "ICD-10-CM")],
    ["Diabetes", legacyChoice("coded", "E11.8", "Diabetes Type II", "ICD-10-CM")],
    ["COPD / chronic lung disease", legacyChoice("coded", "J44.9", "COPD", "ICD-10-CM")],
    ["Stroke / TIA", legacyChoice("coded", "I63.9", "Stroke / TIA", "ICD-10-CM")],
    ["Seizure disorder", legacyChoice("coded", "G40.319", "Epilepsy (Seizures)", "ICD-10-CM")],
    ["No known medical history", legacyChoice("pertinent-negative", "8801015", "None Reported")],
  ]);
  const medications = new Map<string, PatientChoice>([
    ["Antihypertensive", legacyChoice("coded", "LEGACY01", "Antihypertensive", "urn:open-triage:legacy-choice")],
    ["Anticoagulant", legacyChoice("coded", "LEGACY02", "Anticoagulant", "urn:open-triage:legacy-choice")],
    ["Insulin", legacyChoice("coded", "LEGACY03", "Insulin", "urn:open-triage:legacy-choice")],
    ["Inhaler", legacyChoice("coded", "LEGACY04", "Inhaler", "urn:open-triage:legacy-choice")],
    ["No current medications", legacyChoice("pertinent-negative", "8801015", "None Reported")],
  ]);
  const allergies = new Map<string, PatientChoice>([
    ["Penicillin", legacyChoice("coded", "Z88.0", "Penicillin", "ICD-10-CM")],
    ["Sulfonamides", legacyChoice("coded", "Z88.2", "Sulfa Drugs", "ICD-10-CM")],
    ["NSAIDs", legacyChoice("coded", "Z88.6", "Analgesic", "ICD-10-CM")],
    ["Opioids", legacyChoice("coded", "Z88.5", "Narcotic", "ICD-10-CM")],
    ["No known drug allergies", legacyChoice("pertinent-negative", "8801013", "No Known Drug Allergy")],
  ]);
  const selections = (key: string, choices: Map<string, PatientChoice>) => Array.isArray(patient[key])
    ? patient[key].flatMap((label) => typeof label === "string" && choices.has(label) ? [choices.get(label)!] : [])
    : [];
  const legacyName = typeof patient.name === "string" ? patient.name.split(",").map((part) => part.trim()) : [];
  const sex = patient.sex === "F" ? legacyChoice("coded", "9906001", "Female")
    : patient.sex === "M" ? legacyChoice("coded", "9906003", "Male")
      : legacyChoice("coded", "9906005", "Unknown (Unable to Determine)");
  return {
    ...baseline,
    identifier: typeof patient.identifier === "string" ? patient.identifier : baseline.identifier,
    lastName: legacyName[0] || baseline.lastName,
    firstName: legacyName[1] || baseline.firstName,
    age: typeof patient.age === "number" ? patient.age : baseline.age,
    absence: {},
    sex,
    medicalHistory: selections("medicalHistory", history),
    currentMedications: selections("currentMedications", medications),
    allergies: selections("allergies", allergies),
  };
}

export function loadShellStateResult(storage: LocalStoragePort, definition: EncounterDefinition = bundledEncounterDefinition, reportId?: string): ShellStateLoadResult {
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
    const isPreviousEnvelope = LEGACY_PERSISTENCE_VERSIONS.includes(record.persistenceVersion as 2 | 3) && record.state && typeof record.state === "object";
    if (record.persistenceVersion !== undefined && !isCurrentEnvelope && !isPreviousEnvelope) {
      return { status: "invalid", reason: `saved persistence version ${String(record.persistenceVersion)} is not supported`, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    const currentDocument = isCurrentEnvelope ? record.document as Record<string, unknown> : null;
    const currentWorkflow = isCurrentEnvelope ? record.workflow as Partial<ShellState> : null;
    const isEnvelope = isPreviousEnvelope;
    const candidate = (isCurrentEnvelope ? currentWorkflow : isEnvelope ? record.state : record) as Partial<ShellState> & { encounter?: Record<string, unknown> };
    const extension = currentDocument?.[ENCOUNTER_EXTENSION_KEY] as Record<string, unknown> | undefined;
    if (isCurrentEnvelope && (!extension || extension.version !== ENCOUNTER_EXTENSION_VERSION)) {
      return { status: "invalid", reason: `saved extension version ${String(extension?.version)} is not supported`, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    const candidateEncounter = candidate.encounter;
    const savedDefinition = {
      id: isCurrentEnvelope ? (currentDocument?.formProfile as Record<string, unknown> | undefined)?.id as string ?? null : typeof candidateEncounter?.definitionId === "string" ? candidateEncounter.definitionId : null,
      version: isCurrentEnvelope ? Number((currentDocument?.formProfile as Record<string, unknown> | undefined)?.version) || null : Number.isInteger(candidateEncounter?.definitionVersion) ? candidateEncounter!.definitionVersion as number : null,
    };
    const expectedDefinition = { id: definition.id, version: definition.version };
    if (savedDefinition.id !== expectedDefinition.id || savedDefinition.version !== expectedDefinition.version) {
      return { status: "incompatible", savedDefinition, expectedDefinition, recoveryKey: preserveForRecovery(storage, serialized, key) };
    }
    if (!candidate.view || !["timeline", "checklist", "review", "summary"].includes(candidate.view)) return { status: "invalid", reason: "saved view is not supported", recoveryKey: preserveForRecovery(storage, serialized, key) };
    const persistedEvents = isCurrentEnvelope ? extension?.events : candidateEncounter?.events;
    if (!Array.isArray(persistedEvents)) return { status: "invalid", reason: "saved encounter events must be an array", recoveryKey: preserveForRecovery(storage, serialized, key) };
    if (candidate.noteDraft !== null && candidate.noteDraft !== undefined && typeof candidate.noteDraft.summary !== "string") return { status: "invalid", reason: "saved note draft is invalid", recoveryKey: preserveForRecovery(storage, serialized, key) };
    if (candidate.medicationDraft !== null && candidate.medicationDraft !== undefined && typeof candidate.medicationDraft.label !== "string") return { status: "invalid", reason: "saved medication draft is invalid", recoveryKey: preserveForRecovery(storage, serialized, key) };

    const initialDocument = createInitialShellState(definition).encounter.document;
    const legacyEncounter = (candidateEncounter ?? {}) as Record<string, unknown>;
    const legacyPatient = legacyEncounter.patient;
    const needsIncidentMigration = !isCurrentEnvelope && record.persistenceVersion !== 3;
    const migrated = !isCurrentEnvelope;
    let document = currentDocument
      ? loadEncounterDocument(currentDocument, { formProfiles: { [definition.id]: [String(definition.version)] } })
      : candidateEncounter?.document
      ? loadEncounterDocument(candidateEncounter.document, { formProfiles: { [definition.id]: [String(definition.version)] } })
      : legacyPatient && typeof legacyPatient === "object"
        ? updatePatientDocument(initialDocument, migrateLegacyPatient(legacyPatient as Record<string, unknown>, patientDraftFromDocument(initialDocument)), initialDocument.encounter.updatedAt)
        : initialDocument;
    const hasCanonicalIncident = ["eResponseSection", "eDispatchSection", "eCrew.CrewGroup", "eSceneSection", "eTimesSection"].every((id) => document.groups.some((group) => group.id === id));
    const hasLegacyIncident = candidateEncounter?.crew !== undefined || candidateEncounter?.incident !== undefined;
    if (needsIncidentMigration && hasLegacyIncident) {
      document = migrateLegacyIncidentDocument(document, {
        crew: candidateEncounter.crew,
        incident: candidateEncounter.incident,
        events: persistedEvents as ReadonlyArray<Record<string, unknown>>,
      });
    } else if (!hasCanonicalIncident) {
      throw new Error("saved canonical incident data is incomplete");
    }
    if (!isCurrentEnvelope && record.persistenceVersion === 3 && ["currentTime", "crew", "incident"].some((key) => key in candidateEncounter!)) {
      throw new Error("saved state contains parallel legacy incident data");
    }
    const { patient: _legacyPatient, currentTime: _legacyCurrentTime, crew: _legacyCrew, incident: _legacyIncident, ...encounterWithoutLegacy } = legacyEncounter;
    void [_legacyPatient, _legacyCurrentTime, _legacyCrew, _legacyIncident];
    const baselineIds = new Set(["baseline-1", "baseline-2", "baseline-3", "baseline-4"]);
    if (isCurrentEnvelope && persistedEvents.some((event) => baselineIds.has(event.id))) {
      throw new Error("saved state contains parallel legacy incident timeline data");
    }
    const state = {
      ...candidate,
      encounter: {
        ...(isCurrentEnvelope ? { definitionId: definition.id, definitionVersion: definition.version, synthetic: true, ...(extension?.customData ? { customData: extension.customData } : {}) } : encounterWithoutLegacy),
        document,
        events: persistedEvents.filter((event) => !baselineIds.has(event.id)).map((event) => ({ ...event, date: event.date ?? "2026-04-18" })),
      },
      noteDraft: candidate.noteDraft ? { ...candidate.noteDraft, date: candidate.noteDraft.date ?? "2026-04-18" } : null,
      procedureDraft: candidate.procedureDraft ? { ...candidate.procedureDraft, date: candidate.procedureDraft.date ?? "2026-04-18" } : null,
      vitalDraft: candidate.vitalDraft ? { ...candidate.vitalDraft, date: candidate.vitalDraft.date ?? "2026-04-18", values: { ...candidate.vitalDraft.values, nullValues: candidate.vitalDraft.values.nullValues ?? {} } } : null,
      medicationDraft: candidate.medicationDraft ? { ...candidate.medicationDraft, date: candidate.medicationDraft.date ?? "2026-04-18" } : null,
      acknowledgedWarnings: Array.isArray(isCurrentEnvelope ? extension?.acknowledgedWarnings : candidate.acknowledgedWarnings) ? (isCurrentEnvelope ? extension!.acknowledgedWarnings : candidate.acknowledgedWarnings) : [],
    } as unknown as ShellState;
    return { status: "restored", state, migrated };
  } catch (error) {
    const reason = error instanceof EncounterDocumentError || (error instanceof Error && !(error instanceof SyntaxError)) ? error.message : "saved state is not valid JSON";
    return { status: "invalid", reason, recoveryKey: preserveForRecovery(storage, serialized, key) };
  }
}

export function loadShellState(storage: LocalStoragePort, definition: EncounterDefinition = bundledEncounterDefinition, reportId?: string): ShellState | null {
  const result = loadShellStateResult(storage, definition, reportId);
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
