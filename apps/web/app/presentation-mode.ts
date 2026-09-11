export const PRESENTATION_MODE_STORAGE_KEY = "open-triage.presentation-mode.v1";

export type PresentationMode = "mobile" | "stationary" | "admin";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function hasClinicalMode(capabilities?: ReadonlyArray<string>): boolean {
  return capabilities === undefined || capabilities.includes("clinical:document");
}

export function hasAdminMode(capabilities?: ReadonlyArray<string>): boolean {
  return capabilities?.some((capability) => capability !== "clinical:document" && capability !== "clinical:demo") ?? false;
}

export function defaultPresentationMode(capabilities?: ReadonlyArray<string>): PresentationMode {
  return hasAdminMode(capabilities) && !hasClinicalMode(capabilities) ? "admin" : "mobile";
}

export function loadPresentationMode(storage: ReadableStorage, capabilities?: ReadonlyArray<string>): PresentationMode {
  const saved = storage.getItem(PRESENTATION_MODE_STORAGE_KEY);
  if (saved === "admin" && hasAdminMode(capabilities)) return "admin";
  if (saved === "stationary" && hasClinicalMode(capabilities)) return "stationary";
  return defaultPresentationMode(capabilities);
}

export function storePresentationMode(storage: WritableStorage, mode: PresentationMode): void {
  storage.setItem(PRESENTATION_MODE_STORAGE_KEY, mode);
}
