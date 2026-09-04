export const PRESENTATION_MODE_STORAGE_KEY = "open-triage.presentation-mode.v1";

export type PresentationMode = "mobile" | "stationary";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function loadPresentationMode(storage: ReadableStorage): PresentationMode {
  return storage.getItem(PRESENTATION_MODE_STORAGE_KEY) === "stationary" ? "stationary" : "mobile";
}

export function storePresentationMode(storage: WritableStorage, mode: PresentationMode): void {
  storage.setItem(PRESENTATION_MODE_STORAGE_KEY, mode);
}
