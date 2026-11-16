import { feedbackAlertMessageKeys, feedbackAlertSources, type FeedbackVisibleAlert } from "@open-triage/contracts";
import { availableUiLanguages, resolveMessage } from "./localization";
import identifyingPolicy from "../../../packages/database/config/identifying-elements.json";

const identifyingElements = new Set<string>(identifyingPolicy.elements);
function excluded(node: Element): boolean {
  for (let current: Element | null = node; current; current = current.parentElement) {
    const id = current.getAttribute("data-element-id");
    if (current.tagName.includes("-") || (id !== null && (identifyingElements.has(id) || !/^[a-z][A-Za-z]+\.\d{2}$/.test(id)))) return true;
  }
  return false;
}

const knownMessages = new Map(availableUiLanguages.flatMap(language =>
  feedbackAlertMessageKeys.map(key => [resolveMessage(language, key), key] as const)));
const boundedPixels = (value: number) => Number.isFinite(value) ? Math.min(10_000, Math.max(0, Math.round(value))) : 0;

/** Capture before opening feedback; never serialize DOM text, attributes, or field values. */
export function captureVisibleFeedbackAlerts(windowObject: Window): FeedbackVisibleAlert[] {
  const alerts: FeedbackVisibleAlert[] = [];
  const candidates = windowObject.document.querySelectorAll('[role="alert"], .stationary-validation-message, .safety-notice');
  for (const node of candidates) {
    if (alerts.length === 10) break;
    if (excluded(node) || node.closest('.feedback-dialog')) continue;
    const rect = node.getBoundingClientRect();
    const style = windowObject.getComputedStyle(node);
    if (!node.getClientRects().length || style.visibility !== "visible" || style.opacity === "0"
      || rect.bottom <= 0 || rect.top >= windowObject.innerHeight || rect.right <= 0 || rect.left >= windowObject.innerWidth) continue;
    // Exact matches only. Interpolated or unknown text is never retained.
    const messageKey = knownMessages.get(node.textContent?.trim() ?? "");
    const candidateSource = node.getAttribute("data-feedback-source");
    const source = (feedbackAlertSources as readonly unknown[]).includes(candidateSource) ? candidateSource as FeedbackVisibleAlert["source"] : undefined;
    const area: FeedbackVisibleAlert["area"] = node.matches('.stationary-validation-message, .validation-message') ? "validation"
      : source === "protected-storage" || source === "close" || messageKey === "mobile.protectedBeforeClose" ? "storage"
      : source === "signing" ? "signing" : node.matches('.safety-notice, .admin-error, .assignment-error') ? "notice" : "other";
    alerts.push({ area, ...(source ? { source } : {}), ...(messageKey ? { messageKey } : {}), fontSizePx: boundedPixels(Number.parseFloat(style.fontSize)),
      width: boundedPixels(rect.width), height: boundedPixels(rect.height),
      overflowing: node.scrollWidth > node.clientWidth || rect.left < 0 || rect.right > windowObject.innerWidth });
  }
  return alerts;
}
