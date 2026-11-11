/** Native lifecycle is independent of WebView visibility. Browser behavior stays unchanged. */
export const APPLICATION_FOREGROUND_EVENT = "open-triage.foreground-changed";
let nativeForeground = true;

export function foregroundNetworkAllowed(): boolean { return nativeForeground; }
export function applicationVisible(): boolean {
  return nativeForeground && document.visibilityState === "visible";
}
export function setNativeForeground(active: boolean): void {
  if (nativeForeground === active) return;
  nativeForeground = active;
  window.dispatchEvent(new CustomEvent(APPLICATION_FOREGROUND_EVENT, { detail: { active } }));
}
