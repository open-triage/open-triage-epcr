import { foregroundNetworkAllowed, APPLICATION_FOREGROUND_EVENT } from "./application-foreground";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeResponse = { status: number; headers: Record<string, string>; body: string };
export type PairingPreview = { organizationName: string; unitName: string; callSign: string; origin: string };
export type AndroidConnectionState = { configured: boolean; origin?: string; managed?: boolean; managedStatus?: string; blocked?: boolean; managedOrigin?: string; managedContext?: string };
type ConnectionPlugin = {
  beginAuthentication(options: { purpose: "login" | "switch"; csrfToken?: string }): Promise<void>;
  finishAuthentication(): Promise<{outcome: "idle" | "waiting" | "succeeded" | "pending" | "denied" | "failed"}>;
  state(): Promise<AndroidConnectionState>;
  addListener(event: "configurationChanged", listener: (state: AndroidConnectionState) => void): Promise<PluginListenerHandle>;
  preview(options: { artifact: string }): Promise<PairingPreview>;
  confirm(options: { name: string; confirmInstallation: true }): Promise<{ configured: true }>;
  cancel(): Promise<void>;
  request(options: { path: string; method: string; headers: Record<string, string>; body?: string }): Promise<NativeResponse>;
};
export const AndroidConnection = registerPlugin<ConnectionPlugin>("OpenTriageConnection");
export const isAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
let installed = false;
/** Installed before mounting the shared UI, so every ordinary API fetch uses the native cookie boundary. */
export function installAndroidTransport(): void {
  if (installed || !isAndroidRuntime()) return;
  installed = true;
  const browserFetch = window.fetch.bind(window);
  window.fetch = androidFetch(browserFetch, options => AndroidConnection.request(options), window.location.origin);
  installAndroidAuthenticationReturn();
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
    const result = await nativeRequest({ path: target.pathname + target.search, method: effective.method, headers,
      ...(!["GET", "HEAD"].includes(effective.method) ? { body: await effective.text() } : {}) });
    if (effective.signal.aborted) throw effective.signal.reason;
    return new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers });
  };
}

/** No return URI/query parameter supplies authority. Only native vault redemption can complete login. */
export function installAndroidAuthenticationReturn(): void {
  let inFlight = false;
  const poll = async () => {
    if (inFlight || !foregroundNetworkAllowed() || document.visibilityState === "hidden") return;
    inFlight = true;
    try {
      const {outcome} = await AndroidConnection.finishAuthentication();
      if (["succeeded", "pending", "denied", "failed"].includes(outcome)) {
        window.location.assign(`/?authentication=${outcome === "succeeded" ? "completed" : outcome}`);
      }
    } catch { /* Transient outage retains the native encrypted handoff until expiry; managed policy denies independently. */ }
    finally { inFlight = false; }
  };
  window.setInterval(() => { void poll(); }, 1000);
  document.addEventListener("visibilitychange", () => { void poll(); });
  window.addEventListener(APPLICATION_FOREGROUND_EVENT, () => { void poll(); });
  void poll();
}
