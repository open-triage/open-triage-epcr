import type { FeedbackInteractionName, FeedbackRequestFailure } from "@open-triage/contracts";

export const FEEDBACK_INTERACTION_MAX = 20;
export const FEEDBACK_REQUEST_FAILURE_MAX = 10;

const interactions: FeedbackInteractionName[] = [];
const requestFailures: FeedbackRequestFailure[] = [];
const methods = new Set<FeedbackRequestFailure["method"]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const literalSegments = new Set([
  "api", "admin", "review", "calls", "assigned", "synthetic-generation", "feedback", "v1", "submissions",
  "installation", "reports", "open", "sessions", "current", "password", "reauthenticate",
  "context", "users", "roles", "catalogs", "forms", "draft", "changes", "sign", "amend",
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
  NonNullable<import("@open-triage/contracts").FeedbackDiagnosticPayload>, "interactions" | "requestFailures"
> {
  return { interactions: [...interactions].reverse(), requestFailures: [...requestFailures].reverse() };
}

export function clearFeedbackTelemetry(): void {
  interactions.length = 0;
  requestFailures.length = 0;
}

/** Observes only request metadata and response timing; headers and bodies are never read. */
export function installFeedbackRequestTracking(windowObject: Window): () => void {
  const original = windowObject.fetch.bind(windowObject);
  const tracked: typeof windowObject.fetch = async (input, init) => {
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    const method = safeMethod(input, init);
    const endpointPattern = normalizeFeedbackEndpoint(input, windowObject.location.origin);
    try {
      const response = await original(input, init);
      if (method && (response.status === 0 || response.status >= 400)) recordRequestFailure({ timestamp, method, endpointPattern, status: response.status,
        durationMs: Math.min(300_000, Math.max(0, Date.now() - startedAt)) });
      return response;
    } catch (error) {
      if (method) recordRequestFailure({ timestamp, method, endpointPattern, status: 0,
        durationMs: Math.min(300_000, Math.max(0, Date.now() - startedAt)) });
      throw error;
    }
  };
  windowObject.fetch = tracked;
  return () => { if (windowObject.fetch === tracked) windowObject.fetch = original; };
}
