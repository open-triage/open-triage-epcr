import { setNativeStorageScope } from "./native-storage-context";
import { nativeTlsFailure, publishNativeTlsStatus } from "./android-connection-failure";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeResponse = { status: number; headers: Record<string, string>; body: string };
export type PairingPreview = { organizationName: string; unitName: string; callSign: string; origin: string };
export type AndroidConnectionState = { configured: boolean; origin?: string; managed?: boolean; managedStatus?: string; blocked?: boolean; managedOrigin?: string; managedContext?: string; connectionContext?: string; replacementPending?: boolean; pendingOrigin?: string; pendingOutcome?: string; storageScope?: string; legacyStorageScope?: string };
type ConnectionPlugin = {
  state(): Promise<AndroidConnectionState>;
  beginReplacement(): Promise<AndroidConnectionState>;
  resumeEnrollment(): Promise<AndroidConnectionState>;
  previewPendingTrust(options: { artifact: string }): Promise<{ origin: string; trustFingerprint: string }>;
  confirmPendingTrust(options: { confirmTrust: true }): Promise<AndroidConnectionState>;
  abandonUncommittedEnrollment(options: { confirmAbandon: true }): Promise<AndroidConnectionState>;
  addListener(event: "configurationChanged", listener: (state: AndroidConnectionState) => void): Promise<PluginListenerHandle>;
  preview(options: { artifact: string }): Promise<PairingPreview>;
  confirm(options: { name: string; confirmInstallation: true }): Promise<{ configured: true }>;
  cancel(): Promise<void>;
  request(options: { path: string; method: string; headers: Record<string, string>; body?: string; connectionContext?: string }): Promise<NativeResponse>;
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
    let result: NativeResponse;
    try {
      result = await nativeRequest({ ...(expectedContext ? {connectionContext: expectedContext} : {}), path: target.pathname + target.search, method: effective.method, headers,
        ...(!["GET", "HEAD"].includes(effective.method) ? { body: await effective.text() } : {}) });
    } catch (error) {
      if (effective.signal.aborted) throw effective.signal.reason;
      if (expectedContext !== connectionContext) throw new Error("Installation changed");
      if (nativeTlsFailure(error)) publishNativeTlsStatus(true);
      throw error;
    }
    if (effective.signal.aborted) throw effective.signal.reason;
    if (expectedContext !== connectionContext) throw new Error("Installation changed");
    publishNativeTlsStatus(false);
    return new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
  };
}
