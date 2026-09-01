import type { EncounterDefinition } from "./encounter-definition";
import { bundledEncounterDefinition, type ShellState } from "./standard-encounter";

export const STORAGE_KEY = "open-triage:standard-encounter-v1";
export const LEGACY_STORAGE_KEYS = ["open-triage:adult-chest-pain-v2"] as const;

export type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ShellStateLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "legacy-reset"; readonly removedKeys: ReadonlyArray<string> }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "incompatible"; readonly savedDefinition: { readonly id: string | null; readonly version: number | null }; readonly expectedDefinition: { readonly id: string; readonly version: number } }
  | { readonly status: "restored"; readonly state: ShellState };

export function saveShellState(storage: LocalStoragePort, state: ShellState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadShellStateResult(storage: LocalStoragePort, definition: EncounterDefinition = bundledEncounterDefinition): ShellStateLoadResult {
  const removedKeys = LEGACY_STORAGE_KEYS.filter((key) => storage.getItem(key) !== null);
  removedKeys.forEach((key) => storage.removeItem(key));
  const serialized = storage.getItem(STORAGE_KEY);
  if (serialized === null) return removedKeys.length > 0 ? { status: "legacy-reset", removedKeys } : { status: "empty" };
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return { status: "invalid", reason: "saved state must be an object" };
    const candidate = value as Partial<ShellState>;
    const savedDefinition = {
      id: typeof candidate.encounter?.definitionId === "string" ? candidate.encounter.definitionId : null,
      version: Number.isInteger(candidate.encounter?.definitionVersion) ? candidate.encounter!.definitionVersion! : null,
    };
    const expectedDefinition = { id: definition.id, version: definition.version };
    if (savedDefinition.id !== expectedDefinition.id || savedDefinition.version !== expectedDefinition.version) {
      return { status: "incompatible", savedDefinition, expectedDefinition };
    }
    if (!candidate.view || !["timeline", "checklist", "review", "summary"].includes(candidate.view)) return { status: "invalid", reason: "saved view is not supported" };
    if (!Array.isArray(candidate.encounter?.events)) return { status: "invalid", reason: "saved encounter events must be an array" };
    if (candidate.noteDraft !== null && candidate.noteDraft !== undefined && typeof candidate.noteDraft.summary !== "string") return { status: "invalid", reason: "saved note draft is invalid" };
    if (candidate.medicationDraft !== null && candidate.medicationDraft !== undefined && typeof candidate.medicationDraft.label !== "string") return { status: "invalid", reason: "saved medication draft is invalid" };
    const state = {
      ...candidate,
      encounter: {
        ...candidate.encounter,
        patient: {
          ...candidate.encounter.patient,
          medicalHistory: candidate.encounter.patient.medicalHistory ?? [],
          currentMedications: candidate.encounter.patient.currentMedications ?? [],
          allergies: candidate.encounter.patient.allergies ?? [],
        },
        events: candidate.encounter.events.map((event) => ({ ...event, date: event.date ?? "2026-04-18" })),
      },
      noteDraft: candidate.noteDraft ? { ...candidate.noteDraft, date: candidate.noteDraft.date ?? "2026-04-18" } : null,
      procedureDraft: candidate.procedureDraft ? { ...candidate.procedureDraft, date: candidate.procedureDraft.date ?? "2026-04-18" } : null,
      vitalDraft: candidate.vitalDraft ? {
        ...candidate.vitalDraft,
        date: candidate.vitalDraft.date ?? "2026-04-18",
        values: { ...candidate.vitalDraft.values, nullValues: candidate.vitalDraft.values.nullValues ?? {} },
      } : null,
      medicationDraft: candidate.medicationDraft ? { ...candidate.medicationDraft, date: candidate.medicationDraft.date ?? "2026-04-18" } : null,
      acknowledgedWarnings: Array.isArray(candidate.acknowledgedWarnings) ? candidate.acknowledgedWarnings : [],
    } as ShellState;
    return { status: "restored", state };
  } catch {
    return { status: "invalid", reason: "saved state is not valid JSON" };
  }
}

export function loadShellState(storage: LocalStoragePort, definition: EncounterDefinition = bundledEncounterDefinition): ShellState | null {
  const result = loadShellStateResult(storage, definition);
  return result.status === "restored" ? result.state : null;
}

export function clearShellState(storage: LocalStoragePort): void {
  storage.removeItem(STORAGE_KEY);
  LEGACY_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}
