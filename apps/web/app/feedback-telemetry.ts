import { nativeFeedbackSnapshot, clearNativeFeedback } from "./feedback-native";
import type { FeedbackInteractionName, FeedbackRequestFailure } from "@open-triage/contracts";
import { feedbackRuntimeErrorKinds, type FeedbackRuntimeError } from "@open-triage/contracts";

export const FEEDBACK_INTERACTION_MAX = 20;
export const FEEDBACK_REQUEST_FAILURE_MAX = 10;

const interactions: FeedbackInteractionName[] = [];
const requestFailures: FeedbackRequestFailure[] = [];
const runtimeErrors: FeedbackRuntimeError[] = [];
let telemetryGeneration = 0;
const methods = new Set<FeedbackRequestFailure["method"]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const literalSegments = new Set([
  "api", "admin", "review", "calls", "assigned", "synthetic-generation", "feedback", "v1", "submissions",
  "installation", "reports", "open", "sessions", "current", "password", "reauthenticate",
  "context", "eps", "cos", "users", "roles", "catalogs", "forms", "draft", "changes", "sign", "amend",
  "reopen", "assignments", "cancel", "complete", "ownership", "transfer", "preview", "publish",
  "options", "capabilities", "packages", "import", "export", "generate", "delete"
]);

function boundedPush<T>(buffer: T[], value: T, maximum: number): void {
  buffer.push(value);
  if (buffer.length > maximum) buffer.splice(0, buffer.length - maximum);
}

/** Accepts only compile-time approved, application-authored semantic names. */
export function recordFeedbackInteraction(name: FeedbackInteractionName): void {
  boundedPush(interactions, name, FEEDBACK_INTERACTION_MAX);
}

function safeMethod(input: RequestInfo | URL, init?: RequestInit): FeedbackRequestFailure["method"] | null {
  const candidate = String(init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  return methods.has(candidate as FeedbackRequestFailure["method"])
    ? candidate as FeedbackRequestFailure["method"] : null;
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Normalizes immediately; raw URLs and their values are never retained. */
export function normalizeFeedbackEndpoint(input: RequestInfo | URL, baseUrl = "http://localhost"): string {
  try {
    const url = new URL(inputUrl(input), baseUrl);
    const path = url.pathname.split("/").filter(Boolean).slice(0, 12).map((segment) =>
      literalSegments.has(segment) ? segment : "{value}"
    );
    const keys = [...new Set([...url.searchParams.keys()].map((key) =>
      /^[a-z][a-z0-9_-]{0,30}$/i.test(key) ? key.toLowerCase() : "{key}"
    ))].sort().slice(0, 10);
    return `/${path.join("/")}${keys.length ? `?${keys.map((key) => `${key}={value}`).join("&")}` : ""}`;
  } catch {
    return "/{invalid}";
  }
}

function recordRequestFailure(value: FeedbackRequestFailure): void {
  boundedPush(requestFailures, value, FEEDBACK_REQUEST_FAILURE_MAX);
}

export function feedbackTelemetrySnapshot(): Pick<
  NonNullable<import("@open-triage/contracts").FeedbackDiagnosticPayload>, "interactions" | "requestFailures" | "nativeEvents" | "runtimeErrors"
> {
  return { interactions: [...interactions].reverse(), requestFailures: [...requestFailures].reverse(), runtimeErrors: [...runtimeErrors].reverse(),
    ...(nativeFeedbackSnapshot().length ? { nativeEvents: nativeFeedbackSnapshot() } : {}) };
}

export function clearFeedbackTelemetry(): void {
  telemetryGeneration += 1;
  runtimeErrors.length = 0;
  clearNativeFeedback();
  interactions.length = 0;
  requestFailures.length = 0;
}

/** Error messages, rejection values, stack traces and source URLs are never retained. */
export function installFeedbackRuntimeTracking(windowObject: Window): () => void {
  const record = (source: FeedbackRuntimeError["source"], error: unknown) => {
    let kind: FeedbackRuntimeError["kind"] = "other";
    try {
      if (error instanceof Error && (feedbackRuntimeErrorKinds as readonly string[]).includes(error.name)) {
        kind = error.name as FeedbackRuntimeError["kind"];
      }
    } catch { /* Arbitrary rejection objects may have throwing accessors. */ }
    boundedPush(runtimeErrors, { source, kind, timestamp: new Date().toISOString() }, 10);
  };
  const onError = (event: ErrorEvent) => record("error", event.error);
  const onRejection = (event: PromiseRejectionEvent) => record("unhandledrejection", event.reason);
  windowObject.addEventListener("error", onError);
  windowObject.addEventListener("unhandledrejection", onRejection);
  return () => {
    windowObject.removeEventListener("error", onError);
    windowObject.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Observes only request metadata and response timing; headers and bodies are never read. */
export function installFeedbackRequestTracking(windowObject: Window): () => void {
  const original = windowObject.fetch.bind(windowObject);
  const tracked: typeof windowObject.fetch = async (input, init) => {
    const generation = telemetryGeneration;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    const method = safeMethod(input, init);
    const endpointPattern = normalizeFeedbackEndpoint(input, windowObject.location.origin);
    try {
      const response = await original(input, init);
      if (generation === telemetryGeneration && method && (response.status === 0 || response.status >= 400)) recordRequestFailure({ timestamp, method, endpointPattern, status: response.status,
        failureKind: response.status === 0 ? "network" : "http",
        durationMs: Math.min(300_000, Math.max(0, Date.now() - startedAt)) });
      return response;
    } catch (error) {
      const signal = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
      const cancelled = signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (generation === telemetryGeneration && method) recordRequestFailure({ timestamp, method, endpointPattern, status: 0,
        failureKind: cancelled ? "cancelled" : "network",
        durationMs: Math.min(300_000, Math.max(0, Date.now() - startedAt)) });
      throw error;
    }
  };
  windowObject.fetch = tracked;
  return () => { if (windowObject.fetch === tracked) windowObject.fetch = original; };
}
