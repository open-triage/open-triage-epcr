import { INITIAL_CHECKLIST_VALUES, INITIAL_SHELL_STATE, type ShellState } from "./synthetic-encounter";

export const STORAGE_KEY = "open-triage:adult-chest-pain-v2";

export type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveShellState(storage: LocalStoragePort, state: ShellState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadShellState(storage: LocalStoragePort): ShellState | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ShellState>;
    if (!candidate.view || !["timeline", "checklist", "review", "summary"].includes(candidate.view)) return null;
    if (candidate.encounter?.scenarioId !== INITIAL_SHELL_STATE.encounter.scenarioId) return null;
    if (!Array.isArray(candidate.encounter.events)) return null;
    if (candidate.noteDraft !== null && candidate.noteDraft !== undefined && typeof candidate.noteDraft.summary !== "string") return null;
    if (candidate.medicationDraft !== null && candidate.medicationDraft !== undefined && typeof candidate.medicationDraft.label !== "string") return null;
    return {
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
      vitalDraft: candidate.vitalDraft ? { ...candidate.vitalDraft, date: candidate.vitalDraft.date ?? "2026-04-18" } : null,
      medicationDraft: candidate.medicationDraft ? { ...candidate.medicationDraft, date: candidate.medicationDraft.date ?? "2026-04-18" } : null,
      checklistValues: { ...INITIAL_CHECKLIST_VALUES, ...candidate.checklistValues },
      focusedChecklistField: null,
      acknowledgedWarnings: Array.isArray(candidate.acknowledgedWarnings) ? candidate.acknowledgedWarnings : [],
    } as ShellState;
  } catch {
    return null;
  }
}

export function clearShellState(storage: LocalStoragePort): void {
  storage.removeItem(STORAGE_KEY);
}
