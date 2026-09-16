import { BadRequestException } from "@nestjs/common";
import type { CreateFeedbackCommand, FeedbackDiagnosticPayload, FeedbackDiagnostics, FeedbackStructuralKind } from "@open-triage/contracts";

const DIAGNOSTIC_MAX_BYTES = 16_384;
const STRUCTURE_MAX_NODES = 200;
const allowedFields = new Set(["idempotencyKey", "type", "description", "diagnostics"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modes = new Set(["mobile", "stationary", "admin"]);
const screens = new Set(["calls", "encounter", "admin"]);
const browsers = new Set(["chromium", "firefox", "safari", "other"]);
const connectivityStates = new Set(["online", "offline"]);
const viewportCategories = new Set(["narrow", "standard", "wide"]);
const structuralKinds = new Set<FeedbackStructuralKind>([
  "main", "header", "footer", "nav", "section", "article", "aside", "form", "fieldset",
  "table", "list", "button", "dialog", "alert", "status"
]);
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

function validatePayload(value: unknown, type: "bug" | "feature"): FeedbackDiagnosticPayload {
  const payload = record(value, "Diagnostic payload must be an object");
  exact(payload, new Set([
    "schemaVersion", "appVersion", "buildVersion", "mode", "screen", "browserFamily",
    "viewport", "connectivity", ...(type === "bug" ? ["structure"] : [])
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

  return {
    schemaVersion: 1,
    appVersion: payload.appVersion,
    buildVersion: payload.buildVersion,
    mode: payload.mode as FeedbackDiagnosticPayload["mode"],
    screen: payload.screen as FeedbackDiagnosticPayload["screen"],
    browserFamily: payload.browserFamily as FeedbackDiagnosticPayload["browserFamily"],
    viewport: { width: Number(viewport.width), height: Number(viewport.height), category: viewport.category as "narrow" | "standard" | "wide" },
    connectivity: payload.connectivity as FeedbackDiagnosticPayload["connectivity"],
    ...(type === "bug" ? { structure: validateStructure(payload.structure) } : {})
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
