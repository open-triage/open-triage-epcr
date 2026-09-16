import type {
  FeedbackBrowserFamily,
  FeedbackDiagnosticMode,
  FeedbackDiagnosticPayload,
  FeedbackDiagnosticScreen,
  FeedbackDiagnostics,
  FeedbackStructuralKind
} from "@open-triage/contracts";
import identifyingPolicy from "../../../packages/database/config/identifying-elements.json";

export const FEEDBACK_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;
export const FEEDBACK_DIAGNOSTIC_MAX_BYTES = 16_384;
export const FEEDBACK_STRUCTURE_MAX_NODES = 200;
const MAX_DEPTH = 12;
const identifyingElements = new Set<string>(identifyingPolicy.elements);
const structuralKinds = new Map<string, FeedbackStructuralKind>([
  ["MAIN", "main"], ["HEADER", "header"], ["FOOTER", "footer"], ["NAV", "nav"],
  ["SECTION", "section"], ["ARTICLE", "article"], ["ASIDE", "aside"], ["FORM", "form"],
  ["FIELDSET", "fieldset"], ["TABLE", "table"], ["UL", "list"], ["OL", "list"],
  ["BUTTON", "button"], ["DIALOG", "dialog"]
]);

function browserFamily(userAgent: string): FeedbackBrowserFamily {
  if (/Firefox\//i.test(userAgent)) return "firefox";
  if (/Edg\/|Chrome\/|Chromium\//i.test(userAgent)) return "chromium";
  if (/Safari\//i.test(userAgent) && !/Chrome\/|Chromium\//i.test(userAgent)) return "safari";
  return "other";
}

function context(windowObject: Window, mode: FeedbackDiagnosticMode, screen: FeedbackDiagnosticScreen): FeedbackDiagnosticPayload {
  const width = Math.max(1, Math.min(10_000, Math.round(windowObject.innerWidth)));
  const height = Math.max(1, Math.min(10_000, Math.round(windowObject.innerHeight)));
  return {
    schemaVersion: FEEDBACK_DIAGNOSTIC_SCHEMA_VERSION,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
    buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "development",
    mode,
    screen,
    browserFamily: browserFamily(windowObject.navigator.userAgent),
    viewport: { width, height, category: width < 640 ? "narrow" : width < 1200 ? "standard" : "wide" },
    connectivity: windowObject.navigator.onLine ? "online" : "offline"
  };
}

function excluded(node: Element): boolean {
  if (node.tagName.includes("-")) return true;
  const elementId = node.getAttribute("data-element-id");
  return elementId !== null && (identifyingElements.has(elementId) || !/^[a-z][A-Za-z]+\.\d{2}$/.test(elementId));
}

function kindFor(node: Element): FeedbackStructuralKind | undefined {
  const tagKind = structuralKinds.get(node.tagName);
  if (tagKind) return tagKind;
  if (node.getAttribute("role") === "dialog") return "dialog";
  if (node.getAttribute("role") === "alert") return "alert";
  if (node.getAttribute("role") === "status") return "status";
  return undefined;
}

function structuralSnapshot(documentObject: Document): NonNullable<FeedbackDiagnosticPayload["structure"]> {
  const nodes: Array<{ kind: FeedbackStructuralKind; depth: number }> = [];
  let truncated = false;
  const visit = (node: Element, depth: number) => {
    if (excluded(node)) return;
    if (depth > MAX_DEPTH || nodes.length >= FEEDBACK_STRUCTURE_MAX_NODES) { truncated = true; return; }
    const kind = kindFor(node);
    if (kind) nodes.push({ kind, depth });
    for (const child of node.children) {
      if (nodes.length >= FEEDBACK_STRUCTURE_MAX_NODES) { truncated = true; break; }
      visit(child, depth + 1);
    }
  };
  visit(documentObject.body, 0);
  return { nodes, truncated };
}

/** Reduces browser state directly into an allowlisted schema; DOM nodes and values never enter the result. */
export function captureFeedbackDiagnostics(
  windowObject: Window,
  mode: FeedbackDiagnosticMode,
  screen: FeedbackDiagnosticScreen
): FeedbackDiagnostics {
  try {
    const payload = { ...context(windowObject, mode, screen), structure: structuralSnapshot(windowObject.document) };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
      return { status: "unavailable", schemaVersion: 1, reason: "serialization-failed" };
    }
    return { status: "available", payload };
  } catch {
    return { status: "unavailable", schemaVersion: 1, reason: "capture-failed" };
  }
}

export function diagnosticsForType(capture: FeedbackDiagnostics, type: "bug" | "feature"): FeedbackDiagnostics {
  if (capture.status === "unavailable" || type === "bug") return capture;
  const { structure: _structure, ...payload } = capture.payload;
  return { status: "available", payload };
}
