const PREFIX = "open-triage:stationary-timeline-v1:user:";

export function stationaryTimelinePreferenceKey(userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}`;
}

export function loadStationaryTimelineOpen(storage: Pick<Storage, "getItem">, userId: string): boolean {
  try {
    return storage.getItem(stationaryTimelinePreferenceKey(userId)) === "open";
  } catch {
    return false;
  }
}

export function storeStationaryTimelineOpen(storage: Pick<Storage, "setItem">, userId: string, open: boolean): void {
  try {
    storage.setItem(stationaryTimelinePreferenceKey(userId), open ? "open" : "closed");
  } catch {
    // Preference storage is best-effort; the timeline remains usable without it.
  }
}
