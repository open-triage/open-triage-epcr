import { feedbackNativeCodes, feedbackNativeOperations, type FeedbackRuntime, type FeedbackNativeEvent } from "@open-triage/contracts";
import { BadRequestException } from "@nestjs/common";
import { feedbackAlertAreas, feedbackAlertMessageKeys, feedbackAlertSources, feedbackRuntimeErrorKinds,
  type FeedbackVisibleAlert, type FeedbackRuntimeError } from "@open-triage/contracts";
import type {
  CreateFeedbackCommand, FeedbackDiagnosticPayload, FeedbackDiagnostics, FeedbackInteractionName,
  FeedbackRequestFailure, FeedbackStructuralKind
} from "@open-triage/contracts";

const DIAGNOSTIC_MAX_BYTES = 16_384;
const STRUCTURE_MAX_NODES = 200;
const INTERACTION_MAX = 20;
const REQUEST_FAILURE_MAX = 10;
const allowedFields = new Set(["idempotencyKey", "type", "description", "diagnostics"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modes = new Set(["mobile", "stationary", "admin", "review"]);
const screens = new Set(["calls", "encounter", "admin", "review"]);
const browsers = new Set(["chromium", "firefox", "safari", "other"]);
const connectivityStates = new Set(["online", "offline"]);
const viewportCategories = new Set(["narrow", "standard", "wide"]);
const structuralKinds = new Set<FeedbackStructuralKind>([
  "main", "header", "footer", "nav", "section", "article", "aside", "form", "fieldset",
  "table", "list", "button", "dialog", "alert", "status"
]);
const interactionNames = new Set<FeedbackInteractionName>([
  "feedback.opened", "feedback.cancelled", "feedback.type.bug.selected",
  "feedback.type.feature.selected", "feedback.submit.attempted", "session.refresh.requested",
  "session.logout.requested", "presentation.mobile.selected", "presentation.stationary.selected",
  "presentation.admin.selected", "presentation.review.selected", "draft-sync.server-conflict", "draft-sync.validation-rejected",
  "draft-sync.recovered", "draft-sync.retry-exhausted"
]);
const requestMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const endpointLiteralSegments = new Set([
  "api", "admin", "review", "calls", "assigned", "synthetic-generation", "feedback", "v1", "submissions",
  "installation", "reports", "open", "sessions", "current", "password", "reauthenticate",
  "context", "eps", "cos", "users", "roles", "catalogs", "forms", "draft", "changes", "sign", "amend",
  "reopen", "assignments", "cancel", "complete", "ownership", "transfer", "preview", "publish",
  "options", "capabilities", "packages", "import", "export", "generate", "delete"
]);
const endpointPattern = /^\/(?:[a-z0-9-]+|\{(?:value|invalid)\})(?:\/(?:[a-z0-9-]+|\{value\})){0,11}(?:\?(?:[a-z][a-z0-9_-]{0,30}|\{key\})=\{value\}(?:&(?:[a-z][a-z0-9_-]{0,30}|\{key\})=\{value\}){0,9})?$/;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(message);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new BadRequestException(`Unsupported ${path} field: ${unexpected}`);
}

function validateStructure(value: unknown): NonNullable<FeedbackDiagnosticPayload["structure"]> {
  const structure = record(value, "Diagnostic structure must be an object");
  exact(structure, new Set(["nodes", "truncated"]), "diagnostic structure");
  if (!Array.isArray(structure.nodes) || structure.nodes.length > STRUCTURE_MAX_NODES) {
    throw new BadRequestException("Diagnostic structure must contain at most 200 nodes");
  }
  const nodes = structure.nodes.map((value, index) => {
    const node = record(value, `Diagnostic structure node ${index} must be an object`);
    exact(node, new Set(["kind", "depth"]), `diagnostic structure node ${index}`);
    if (!structuralKinds.has(node.kind as FeedbackStructuralKind)) {
      throw new BadRequestException(`Diagnostic structure node ${index} has an unsupported kind`);
    }
    if (!Number.isInteger(node.depth) || Number(node.depth) < 0 || Number(node.depth) > 12) {
      throw new BadRequestException(`Diagnostic structure node ${index} has an invalid depth`);
    }
    return { kind: node.kind as FeedbackStructuralKind, depth: Number(node.depth) };
  });
  if (typeof structure.truncated !== "boolean") throw new BadRequestException("Diagnostic structure truncated must be boolean");
  return { nodes, truncated: structure.truncated };
}

function validateInteractions(value: unknown): FeedbackInteractionName[] {
  if (!Array.isArray(value) || value.length > INTERACTION_MAX) {
    throw new BadRequestException("Diagnostic interactions must contain at most 20 approved names");
  }
  return value.map((name, index) => {
    if (!interactionNames.has(name as FeedbackInteractionName)) {
      throw new BadRequestException(`Diagnostic interaction ${index} is unsupported`);
    }
    return name as FeedbackInteractionName;
  });
}

function validEndpointPattern(value: string): boolean {
  if (!endpointPattern.test(value)) return false;
  const path = value.split("?", 1)[0]!;
  return path.split("/").filter(Boolean).every((segment) =>
    segment === "{value}" || segment === "{invalid}" || endpointLiteralSegments.has(segment)
  );
}

function validateRequestFailures(value: unknown): FeedbackRequestFailure[] {
  if (!Array.isArray(value) || value.length > REQUEST_FAILURE_MAX) {
    throw new BadRequestException("Diagnostic request failures must contain at most 10 summaries");
  }
  return value.map((item, index) => {
    const failure = record(item, `Diagnostic request failure ${index} must be an object`);
    exact(failure, new Set(["timestamp", "method", "endpointPattern", "status", "durationMs", "failureKind"]), `diagnostic request failure ${index}`);
    if (typeof failure.timestamp !== "string" || !isoTimestamp.test(failure.timestamp)
      || Number.isNaN(Date.parse(failure.timestamp))) throw new BadRequestException(`Diagnostic request failure ${index} has an invalid timestamp`);
    if (!requestMethods.has(failure.method as string)) throw new BadRequestException(`Diagnostic request failure ${index} has an invalid method`);
    if (typeof failure.endpointPattern !== "string" || !validEndpointPattern(failure.endpointPattern)) {
      throw new BadRequestException(`Diagnostic request failure ${index} has an invalid endpoint pattern`);
    }
    if (!Number.isInteger(failure.status) || (Number(failure.status) !== 0 && (Number(failure.status) < 400 || Number(failure.status) > 599))) {
      throw new BadRequestException(`Diagnostic request failure ${index} has an invalid status`);
    }
    if (!Number.isInteger(failure.durationMs) || Number(failure.durationMs) < 0 || Number(failure.durationMs) > 300_000) {
      throw new BadRequestException(`Diagnostic request failure ${index} has an invalid duration`);
    }
    if (failure.failureKind !== undefined && (!(["http", "network", "cancelled"] as unknown[]).includes(failure.failureKind)
      || (failure.status === 0 ? failure.failureKind === "http" : failure.failureKind !== "http"))) {
      throw new BadRequestException("Invalid diagnostic request failure kind");
    }
    return { ...(failure.failureKind === undefined ? {} : { failureKind: failure.failureKind }),
      timestamp: failure.timestamp, method: failure.method, endpointPattern: failure.endpointPattern,
      status: Number(failure.status), durationMs: Number(failure.durationMs) } as FeedbackRequestFailure;
  });
}

function validateRuntime(value: unknown): FeedbackRuntime {
  const runtime = record(value, "Diagnostic runtime must be an object");
  if (runtime.platform === "browser") {
    exact(runtime, new Set(["platform"]), "diagnostic runtime");
    return { platform: "browser" };
  }
  if (runtime.platform !== "android") throw new BadRequestException("Invalid diagnostic runtime platform");
  exact(runtime, new Set(["platform", "versionCode", "versionName", "androidApiLevel", "webViewVersion"]), "diagnostic runtime");
  const result: Extract<FeedbackRuntime, { platform: "android" }> = { platform: "android" };
  for (const key of ["versionCode", "androidApiLevel"] as const) {
    if (runtime[key] === undefined) continue;
    if (!Number.isSafeInteger(runtime[key]) || Number(runtime[key]) < 1 || (key === "androidApiLevel" && Number(runtime[key]) > 1000)) {
      throw new BadRequestException(`Invalid diagnostic runtime ${key}`);
    }
    result[key] = Number(runtime[key]);
  }
  for (const key of ["versionName", "webViewVersion"] as const) {
    if (runtime[key] === undefined) continue;
    if (typeof runtime[key] !== "string" || runtime[key].length > 64 || !/^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.]+)?$/.test(runtime[key])) {
      throw new BadRequestException(`Invalid diagnostic runtime ${key}`);
    }
    result[key] = runtime[key];
  }
  return result;
}
function validateNativeEvents(value: unknown): FeedbackNativeEvent[] {
  if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("Diagnostic native events must contain at most 20 summaries");
  return value.map(item => {
    const event = record(item, "Diagnostic native event must be an object");
    exact(event, new Set(["operation", "code", "timestamp", "durationMs"]), "diagnostic native event");
    if (!(feedbackNativeOperations as readonly unknown[]).includes(event.operation) || !(feedbackNativeCodes as readonly unknown[]).includes(event.code)) {
      throw new BadRequestException("Unsupported diagnostic native event category");
    }
    if (typeof event.timestamp !== "string" || !isoTimestamp.test(event.timestamp) || Number.isNaN(Date.parse(event.timestamp))) {
      throw new BadRequestException("Invalid diagnostic native event timestamp");
    }
    if (!Number.isInteger(event.durationMs) || Number(event.durationMs) < 0 || Number(event.durationMs) > 300_000) {
      throw new BadRequestException("Invalid diagnostic native event duration");
    }
    return { operation: event.operation, code: event.code, timestamp: event.timestamp, durationMs: event.durationMs } as FeedbackNativeEvent;
  });
}

function validateVisibleAlerts(value: unknown): FeedbackVisibleAlert[] {
  if (!Array.isArray(value) || value.length > 10) throw new BadRequestException("Diagnostic visible alerts must contain at most 10 summaries");
  return value.map(item => {
    const alert = record(item, "Diagnostic visible alert must be an object");
    exact(alert, new Set(["area", "source", "messageKey", "fontSizePx", "width", "height", "overflowing"]), "diagnostic visible alert");
    if (!(feedbackAlertAreas as readonly unknown[]).includes(alert.area)
      || (alert.source !== undefined && !(feedbackAlertSources as readonly unknown[]).includes(alert.source))
      || (alert.messageKey !== undefined && !(feedbackAlertMessageKeys as readonly unknown[]).includes(alert.messageKey))) {
      throw new BadRequestException("Unsupported diagnostic visible alert category");
    }
    for (const key of ["fontSizePx", "width", "height"] as const) {
      if (!Number.isInteger(alert[key]) || Number(alert[key]) < 0 || Number(alert[key]) > 10_000) {
        throw new BadRequestException("Invalid diagnostic visible alert measurement");
      }
    }
    if (typeof alert.overflowing !== "boolean") throw new BadRequestException("Invalid diagnostic visible alert overflow");
    return { area: alert.area, ...(alert.source === undefined ? {} : { source: alert.source }), ...(alert.messageKey === undefined ? {} : { messageKey: alert.messageKey }),
      fontSizePx: alert.fontSizePx, width: alert.width, height: alert.height, overflowing: alert.overflowing } as FeedbackVisibleAlert;
  });
}

function validateRuntimeErrors(value: unknown): FeedbackRuntimeError[] {
  if (!Array.isArray(value) || value.length > 10) throw new BadRequestException("Diagnostic runtime errors must contain at most 10 summaries");
  return value.map(item => {
    const error = record(item, "Diagnostic runtime error must be an object");
    exact(error, new Set(["source", "kind", "timestamp"]), "diagnostic runtime error");
    if ((error.source !== "error" && error.source !== "unhandledrejection")
      || !(feedbackRuntimeErrorKinds as readonly unknown[]).includes(error.kind)) {
      throw new BadRequestException("Unsupported diagnostic runtime error category");
    }
    if (typeof error.timestamp !== "string" || !isoTimestamp.test(error.timestamp) || Number.isNaN(Date.parse(error.timestamp))) {
      throw new BadRequestException("Invalid diagnostic runtime error timestamp");
    }
    return { source: error.source, kind: error.kind, timestamp: error.timestamp } as FeedbackRuntimeError;
  });
}

function validatePayload(value: unknown, type: "bug" | "feature"): FeedbackDiagnosticPayload {
  const payload = record(value, "Diagnostic payload must be an object");
  exact(payload, new Set([
    "schemaVersion", "appVersion", "buildVersion", "mode", "screen", "browserFamily",
    "viewport", "connectivity", "runtime", ...(type === "bug" ? ["structure", "interactions", "requestFailures", "nativeEvents", "visibleAlerts", "runtimeErrors"] : [])
  ]), "diagnostic payload");
  if (payload.schemaVersion !== 1) throw new BadRequestException("Unsupported diagnostic schema version");
  if (typeof payload.appVersion !== "string" || !safeVersion.test(payload.appVersion)) throw new BadRequestException("Invalid diagnostic app version");
  if (typeof payload.buildVersion !== "string" || !safeVersion.test(payload.buildVersion)) throw new BadRequestException("Invalid diagnostic build version");
  if (!modes.has(payload.mode as string)) throw new BadRequestException("Invalid diagnostic mode");
  if (!screens.has(payload.screen as string)) throw new BadRequestException("Invalid diagnostic screen");
  if (!browsers.has(payload.browserFamily as string)) throw new BadRequestException("Invalid diagnostic browser family");
  if (!connectivityStates.has(payload.connectivity as string)) throw new BadRequestException("Invalid diagnostic connectivity");
  const viewport = record(payload.viewport, "Diagnostic viewport must be an object");
  exact(viewport, new Set(["width", "height", "category"]), "diagnostic viewport");
  if (!Number.isInteger(viewport.width) || Number(viewport.width) < 1 || Number(viewport.width) > 10_000
    || !Number.isInteger(viewport.height) || Number(viewport.height) < 1 || Number(viewport.height) > 10_000
    || !viewportCategories.has(viewport.category as string)) throw new BadRequestException("Invalid diagnostic viewport");
  const expectedCategory = Number(viewport.width) < 640 ? "narrow" : Number(viewport.width) < 1200 ? "standard" : "wide";
  if (viewport.category !== expectedCategory) throw new BadRequestException("Diagnostic viewport category does not match width");
  if (type === "bug" && payload.structure === undefined) throw new BadRequestException("Bug diagnostics require a structural snapshot");
  if (type === "bug" && payload.interactions === undefined) throw new BadRequestException("Bug diagnostics require interaction history");
  if (type === "bug" && payload.requestFailures === undefined) throw new BadRequestException("Bug diagnostics require request-failure history");

  const runtime = payload.runtime === undefined ? undefined : validateRuntime(payload.runtime);
  if (payload.nativeEvents !== undefined && runtime?.platform !== "android") throw new BadRequestException("Native events require Android runtime");
  return {
    ...(runtime ? { runtime } : {}),
    schemaVersion: 1,
    appVersion: payload.appVersion,
    buildVersion: payload.buildVersion,
    mode: payload.mode as FeedbackDiagnosticPayload["mode"],
    screen: payload.screen as FeedbackDiagnosticPayload["screen"],
    browserFamily: payload.browserFamily as FeedbackDiagnosticPayload["browserFamily"],
    viewport: { width: Number(viewport.width), height: Number(viewport.height), category: viewport.category as "narrow" | "standard" | "wide" },
    connectivity: payload.connectivity as FeedbackDiagnosticPayload["connectivity"],
    ...(type === "bug" ? {
      structure: validateStructure(payload.structure),
      interactions: validateInteractions(payload.interactions),
      requestFailures: validateRequestFailures(payload.requestFailures),
      ...(payload.visibleAlerts === undefined ? {} : { visibleAlerts: validateVisibleAlerts(payload.visibleAlerts) }),
      ...(payload.runtimeErrors === undefined ? {} : { runtimeErrors: validateRuntimeErrors(payload.runtimeErrors) }),
      ...(payload.nativeEvents === undefined ? {} : { nativeEvents: validateNativeEvents(payload.nativeEvents) })
    } : {})
  };
}

function validateDiagnostics(value: unknown, type: "bug" | "feature"): FeedbackDiagnostics {
  const diagnostics = record(value, "Diagnostics must be an object");
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new BadRequestException("Diagnostics must be serializable"); }
  if (Buffer.byteLength(encoded, "utf8") > DIAGNOSTIC_MAX_BYTES) throw new BadRequestException("Diagnostics exceed 16,384 bytes");
  if (diagnostics.status === "available") {
    exact(diagnostics, new Set(["status", "payload"]), "diagnostics");
    return { status: "available", payload: validatePayload(diagnostics.payload, type) };
  }
  if (diagnostics.status === "unavailable") {
    exact(diagnostics, new Set(["status", "schemaVersion", "reason"]), "diagnostics");
    if (diagnostics.schemaVersion !== 1) throw new BadRequestException("Unsupported diagnostic schema version");
    if (diagnostics.reason !== "capture-failed" && diagnostics.reason !== "serialization-failed") throw new BadRequestException("Invalid diagnostic unavailable reason");
    return { status: "unavailable", schemaVersion: 1, reason: diagnostics.reason };
  }
  throw new BadRequestException("Invalid diagnostic status");
}
export function validateCreateFeedback(input: unknown): CreateFeedbackCommand {
  const feedback = record(input, "Feedback must be an object");
  exact(feedback, allowedFields, "feedback");
  if (feedback.type !== "bug" && feedback.type !== "feature") throw new BadRequestException("Feedback type must be bug or feature");
  if (typeof feedback.description !== "string") throw new BadRequestException("Feedback description is required");
  const description = feedback.description.trim();
  if (!description) throw new BadRequestException("Feedback description is required");
  if (description.length > 4000) throw new BadRequestException("Feedback description must be 4,000 characters or fewer");
  if (typeof feedback.idempotencyKey !== "string" || !UUID_PATTERN.test(feedback.idempotencyKey)) {
    throw new BadRequestException("Feedback idempotency key must be a UUID");
  }
  return {
    idempotencyKey: feedback.idempotencyKey.toLowerCase(),
    type: feedback.type,
    description,
    diagnostics: validateDiagnostics(feedback.diagnostics, feedback.type)
  };
}
