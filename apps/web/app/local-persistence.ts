import { INITIAL_CHECKLIST_VALUES, INITIAL_SHELL_STATE, type ShellState } from "./synthetic-encounter";

export const STORAGE_KEY = "open-triage:adult-chest-pain-v1";

export type LocalStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveShellState(storage: LocalStoragePort, state: ShellState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadShellState(storage: LocalStoragePort): ShellState | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ShellState>;
    if (candidate.view !== "timeline" && candidate.view !== "checklist") return null;
    if (candidate.encounter?.scenarioId !== INITIAL_SHELL_STATE.encounter.scenarioId) return null;
    if (!Array.isArray(candidate.encounter.events)) return null;
    if (candidate.noteDraft !== null && candidate.noteDraft !== undefined && typeof candidate.noteDraft.summary !== "string") return null;
    return {
      ...candidate,
      noteDraft: candidate.noteDraft ?? null,
      checklistValues: { ...INITIAL_CHECKLIST_VALUES, ...candidate.checklistValues },
      focusedChecklistField: null,
    } as ShellState;
  } catch {
    return null;
  }
}

export function clearShellState(storage: LocalStoragePort): void {
  storage.removeItem(STORAGE_KEY);
}
