export const ANDROID_TLS_STATUS_EVENT = "open-triage.android-tls-status";

/** A category only: never expose a native exception's certificate or credential details. */
export function nativeTlsFailure(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "TLS_FAILED";
}
export function publishNativeTlsStatus(failed: boolean): void {
  window.dispatchEvent(new CustomEvent(ANDROID_TLS_STATUS_EVENT, { detail: { failed } }));
}
