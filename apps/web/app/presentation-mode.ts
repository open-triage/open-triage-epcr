export const PRESENTATION_MODE_STORAGE_KEY = "open-triage.presentation-mode.v1";

export type PresentationMode = "mobile" | "stationary" | "admin" | "review";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function hasClinicalMode(capabilities?: ReadonlyArray<string>): boolean {
  return capabilities === undefined || capabilities.includes("clinical:document");
}

export function hasAdminMode(capabilities?: ReadonlyArray<string>): boolean {
  return capabilities?.some((capability) =>
    capability === "review:admin" || /^(admin-dashboard|catalog|credentials|forms|roles|sessions|settings|users|validation):/.test(capability)) ?? false;
}

export function hasReviewMode(capabilities?: ReadonlyArray<string>): boolean {
  return capabilities?.includes("review:self") === true || capabilities?.includes("review:all") === true;
}

export function defaultPresentationMode(capabilities?: ReadonlyArray<string>): PresentationMode {
  if (hasClinicalMode(capabilities)) return "mobile";
  if (hasReviewMode(capabilities)) return "review";
  return hasAdminMode(capabilities) ? "admin" : "mobile";
}

export function loadPresentationMode(storage: ReadableStorage, capabilities?: ReadonlyArray<string>): PresentationMode {
  const saved = storage.getItem(PRESENTATION_MODE_STORAGE_KEY);
  if (saved === "admin" && hasAdminMode(capabilities)) return "admin";
  if (saved === "review" && hasReviewMode(capabilities)) return "review";
  if (saved === "stationary" && hasClinicalMode(capabilities)) return "stationary";
  return defaultPresentationMode(capabilities);
}

export function storePresentationMode(storage: WritableStorage, mode: PresentationMode): void {
  storage.setItem(PRESENTATION_MODE_STORAGE_KEY, mode);
}
