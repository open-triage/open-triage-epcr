import { foregroundNetworkAllowed, APPLICATION_FOREGROUND_EVENT } from "./application-foreground";
import { setNativeStorageScope } from "./native-storage-context";
import { nativeTlsFailure, publishNativeTlsStatus } from "./android-connection-failure";
import { INSTALLATION_TRANSITION_KEY } from "./installation-transition-generation";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeResponse = { status: number; headers: Record<string, string>; bodyBase64: string };
export type PairingPreview = { organizationName: string; unitName: string; callSign: string; origin: string };
export type AndroidConnectionState = { configured: boolean; origin?: string; managed?: boolean; managedStatus?: string; blocked?: boolean; managedOrigin?: string; managedContext?: string; connectionContext?: string; replacementPending?: boolean; pendingOrigin?: string; pendingOutcome?: string; storageScope?: string; legacyStorageScope?: string };
type ConnectionPlugin = {
  version(): Promise<{versionCode: number}>;
  beginAuthentication(options: { purpose: "login" | "switch"; csrfToken?: string }): Promise<void>;
  finishAuthentication(): Promise<{outcome: "idle" | "waiting" | "succeeded" | "pending" | "denied" | "failed"}>;
  state(): Promise<AndroidConnectionState>;
  reconcileTransition(options: { connectionContext: string; purpose:"enrollment"|"logout" }): Promise<AndroidConnectionState>;
  beginReplacement(): Promise<AndroidConnectionState>;
  resumeEnrollment(): Promise<AndroidConnectionState>;
  previewPendingTrust(options: { artifact: string }): Promise<{ origin: string; trustFingerprint: string }>;
  confirmPendingTrust(options: { confirmTrust: true }): Promise<AndroidConnectionState>;
  abandonUncommittedEnrollment(options: { confirmAbandon: true }): Promise<AndroidConnectionState>;
  addListener(event: "configurationChanged", listener: (state: AndroidConnectionState) => void): Promise<PluginListenerHandle>;
  preview(options: { artifact: string }): Promise<PairingPreview>;
  confirm(options: { name: string; confirmInstallation: true }): Promise<{ configured: true }>;
  cancel(): Promise<void>;
  request(options: { path: string; method: string; headers: Record<string, string>; bodyBase64?: string; connectionContext?: string }): Promise<NativeResponse>;
};
export const AndroidConnection = registerPlugin<ConnectionPlugin>("OpenTriageConnection");
export const isAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
let installed = false;
let connectionContext: string | undefined;
export function configureNativeConnection(state: AndroidConnectionState): void {
  connectionContext = state.connectionContext;
  if (state.origin) { if(!state.storageScope) throw new Error("Native storage context unavailable"); setNativeStorageScope(state.storageScope, state.legacyStorageScope); }
}
/** Installed before mounting the shared UI, so every ordinary API fetch uses the native cookie boundary. */
export function installAndroidTransport(): void {
  if (installed || !isAndroidRuntime()) return;
  installed = true;
  const browserFetch = window.fetch.bind(window);
  window.fetch = androidFetch(browserFetch, options => AndroidConnection.request(options), window.location.origin);
  installAndroidAuthenticationReturn();
}

// Bound bridge copies while supporting a default 10 MiB photo in its JSON command.
export const MAX_NATIVE_BODY_BYTES = 16 * 1024 * 1024;
function encodeBytes(bytes: Uint8Array): string {
  if (bytes.length > MAX_NATIVE_BODY_BYTES) throw new Error("Oversized native request");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function decodeBytes(encoded: string): Uint8Array<ArrayBuffer> {
  if (encoded.length > Math.ceil(MAX_NATIVE_BODY_BYTES / 3) * 4) throw new Error("Oversized native response");
  const binary = atob(encoded);
  if (binary.length > MAX_NATIVE_BODY_BYTES) throw new Error("Oversized native response");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function androidFetch(browserFetch: typeof fetch, nativeRequest: ConnectionPlugin["request"], localOrigin: string): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(typeof input === "string" ? input : input.href, `${localOrigin}/`));
    const target = new URL(request.url);
    // Bundled assets stay local. Never route an absolute external origin through a credentialed bridge.
    if (target.origin !== localOrigin || !target.pathname.startsWith("/api/")) return browserFetch(input, init);
    const effective = new Request(request, init);
    if (effective.signal.aborted) throw effective.signal.reason;
    const headers: Record<string, string> = {};
    effective.headers.forEach((value, name) => { headers[name] = value; });
    const expectedContext = connectionContext;
    const declaredLength = Number(effective.headers.get("content-length"));
    if (declaredLength > MAX_NATIVE_BODY_BYTES) throw new Error("Oversized native request");
    const body = !["GET", "HEAD"].includes(effective.method) ? { bodyBase64: encodeBytes(new Uint8Array(await effective.arrayBuffer())) } : {};
    if (effective.signal.aborted) throw effective.signal.reason;
    if (expectedContext !== connectionContext) throw new Error("Installation changed");
    let result: NativeResponse;
    try {
      result = await nativeRequest({ ...(expectedContext ? {connectionContext: expectedContext} : {}), path: target.pathname + target.search, method: effective.method, headers, ...body });
    } catch (error) {
      if (effective.signal.aborted) throw effective.signal.reason;
      if (expectedContext !== connectionContext) throw new Error("Installation changed");
      if (nativeTlsFailure(error)) publishNativeTlsStatus(true);
      throw error;
    }
    if (effective.signal.aborted) throw effective.signal.reason;
    if (expectedContext !== connectionContext) throw new Error("Installation changed");
    publishNativeTlsStatus(false);
    return new Response(effective.method === "HEAD" || [204, 205, 304].includes(result.status) ? null : decodeBytes(result.bodyBase64), { status: result.status, headers: result.headers });
  };
}

/** Stale completions cannot navigate a newly selected installation or replacement preview. */
export async function pollAndroidAuthenticationReturn(
  finish: ConnectionPlugin["finishAuthentication"] = () => AndroidConnection.finishAuthentication(),
  redirect: (path: string) => void = path => window.location.assign(path),
): Promise<void> {
  if(typeof window!=="undefined"&&window.localStorage?.getItem(INSTALLATION_TRANSITION_KEY))return;
  const expectedContext = connectionContext;
  const {outcome} = await finish();
  if (expectedContext !== connectionContext || typeof window!=="undefined"&&window.localStorage?.getItem(INSTALLATION_TRANSITION_KEY)) return;
  if (["succeeded", "pending", "denied", "failed"].includes(outcome))
    redirect(`/?authentication=${outcome === "succeeded" ? "completed" : outcome}`);
}

/** No return URI/query parameter supplies authority. Only native vault redemption can complete login. */
export function installAndroidAuthenticationReturn(): void {
  let inFlight = false;
  const poll = async () => {
    if (inFlight || !foregroundNetworkAllowed() || document.visibilityState === "hidden") return;
    inFlight = true;
    try {
      await pollAndroidAuthenticationReturn();
    } catch { /* Transient outage retains the native encrypted handoff until expiry; managed policy denies independently. */ }
    finally { inFlight = false; }
  };
  window.setInterval(() => { void poll(); }, 1000);
  document.addEventListener("visibilitychange", () => { void poll(); });
  window.addEventListener(APPLICATION_FOREGROUND_EVENT, () => { void poll(); });
  void poll();
}
