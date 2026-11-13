const blockers = new Set<symbol>();
export const UI_UPDATE_CHECK_EVENT = "open-triage:ui-update-check";
export const UI_UPDATE_FAILED_EVENT = "open-triage:ui-update-failed";
export const UI_UPDATE_BOUNDARY_EVENT = "open-triage:ui-update-boundary";
export const canApplyUiUpdate = () => blockers.size === 0;

/** Share reload protection between browser updates, native updates and explicit-save editors. */
export function blockUiUpdates(): () => void {
  const token = Symbol(); blockers.add(token);
  return () => {
    if (!blockers.delete(token)) return;
    window.dispatchEvent(new Event(UI_UPDATE_BOUNDARY_EVENT));
  };
}
