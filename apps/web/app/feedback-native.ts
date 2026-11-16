import { Capacitor } from "@capacitor/core";
import { feedbackNativeCodes, type FeedbackNativeEvent, type FeedbackRuntime } from "@open-triage/contracts";

const events: FeedbackNativeEvent[] = [];
let generation = 0;
const codes = new Set<string>(feedbackNativeCodes);
let androidVersion: Omit<Extract<FeedbackRuntime, { platform: "android" }>, "platform"> = {};
const android = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
const versionPattern = /^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.]+)?$/;

/** Older APKs supply only versionCode. Never retain arbitrary bridge metadata. */
export function setFeedbackAndroidVersion(value: Record<string, unknown>): void {
  const next: typeof androidVersion = {};
  if (Number.isSafeInteger(value.versionCode) && Number(value.versionCode) > 0) next.versionCode = Number(value.versionCode);
  if (Number.isInteger(value.androidApiLevel) && Number(value.androidApiLevel) > 0 && Number(value.androidApiLevel) <= 1000) next.androidApiLevel = Number(value.androidApiLevel);
  for (const key of ["versionName", "webViewVersion"] as const) {
    if (typeof value[key] === "string" && value[key].length <= 64 && versionPattern.test(value[key])) next[key] = value[key];
  }
  androidVersion = next;
}
export function feedbackRuntimeSnapshot(): FeedbackRuntime {
  return android() ? { platform: "android", ...androidVersion } : { platform: "browser" };
}
export function recordNativeFeedback(operation: FeedbackNativeEvent["operation"], code: string, startedAt = Date.now()): void {
  if (!android()) return;
  events.push({ operation, code: codes.has(code) ? code as FeedbackNativeEvent["code"] : "FAILED",
    timestamp: new Date().toISOString(), durationMs: Math.min(300_000, Math.max(0, Date.now() - startedAt)) });
  if (events.length > 20) events.splice(0, events.length - 20);
}
export function nativeFeedbackSnapshot(): FeedbackNativeEvent[] { return events.map(event => ({ ...event })).reverse(); }
export function clearNativeFeedback(): void { generation++; events.length = 0; }

/** Wrap approved methods only; listener handles, arguments and result bodies are never buffered. */
export function observeNativeFeedback<T extends object>(plugin: T, operations: Partial<Record<keyof T, FeedbackNativeEvent["operation"]>>): T {
  const outcomes = new Map<PropertyKey, string>();
  let outcomeGeneration = generation;
  return new Proxy(plugin, {
    get(target, property, receiver) {
      const operation = Object.hasOwn(operations, property) ? operations[property as keyof T] : undefined;
      const method = Reflect.get(target, property, receiver);
      if (!operation || typeof method !== "function") return method;
      return async (...args: unknown[]) => {
        const startedAt = Date.now();
        const expectedGeneration = generation;
        const record = (code: string) => { if (generation === expectedGeneration) recordNativeFeedback(operation, code, startedAt); };
        try {
          const result = await method.apply(target, args);
          if (generation !== expectedGeneration) return result;
          if (outcomeGeneration !== generation) { outcomes.clear(); outcomeGeneration = generation; }
          // Polling a stable denied/pending or blocked state must not erase earlier failures.
          if (operation === "authentication" || operation === "configuration") {
            const outcome = operation === "authentication"
              ? ["idle", "waiting", "succeeded", "pending", "denied", "failed"].includes(result?.outcome) ? result.outcome : "ready"
              : result?.blocked === true ? "blocked" : "ready";
            const previous = outcomes.get(property);
            outcomes.set(property, outcome);
            if (previous !== outcome) {
              if (["failed", "denied", "pending"].includes(outcome)) record(outcome.toUpperCase());
              if (outcome === "blocked") record("MANAGED_BLOCKED");
            }
          } else if (operation === "pdf" && result?.opened === false) {
            record(typeof result.code === "string" ? result.code : "pdf.unavailable");
          }
          return result;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          record(typeof code === "string" ? code : "FAILED");
          throw error;
        }
      };
    }
  });
}

export function recordNativeMediaFailure(operation: "camera" | "microphone", error: unknown): void {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  recordNativeFeedback(operation, name === "NotAllowedError" || name === "SecurityError" ? "PERMISSION_DENIED" : "FAILED");
}
