import { resolveErrorMessage, type AgencyLanguage } from "./localization";
export type MediaCaptureKind = "camera" | "microphone";

const LABELS = {
  camera: { label: "Camera", device: "camera", browser: "iOS Safari or Android Chrome" },
  microphone: { label: "Microphone", device: "microphone", browser: "iOS Safari or Android Chrome" },
} as const;

export function mediaCapturePreflightMessage(kind: MediaCaptureKind, environment: {
  readonly secureContext: boolean;
  readonly hasGetUserMedia: boolean;
  readonly hasRecorder?: boolean;
}): string | null {
  const labels = LABELS[kind];
  if (!environment.secureContext) {
    return `${labels.label} capture requires a secure HTTPS connection. Reopen this agency site over HTTPS. Text notes remain available.`;
  }
  if (!environment.hasGetUserMedia) {
    return `Live ${labels.device} capture is not supported by this browser or device. Use a supported ${labels.browser} device. Text notes remain available.`;
  }
  if (kind === "microphone" && environment.hasRecorder === false) {
    return "Spoken-audio recording is not supported by this browser. Use a supported iOS Safari or Android Chrome device. Text notes remain available.";
  }
  return null;
}

export function mediaCaptureErrorMessage(kind: MediaCaptureKind, error: unknown, language: AgencyLanguage = "en"): string {
  const labels = LABELS[kind];
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return resolveErrorMessage(language, `${labels.label} access is blocked. Allow ${labels.device} access for this site in browser settings, then try again. Text notes remain available.`, kind === "camera" ? "noteUi.capture.cameraAccessBlocked" : "noteUi.capture.microphoneAccessBlocked");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return resolveErrorMessage(language, `No ${labels.device} was found. Connect or enable a ${labels.device}, then try again. Text notes remain available.`, kind === "camera" ? "noteUi.capture.cameraNotFound" : "noteUi.capture.microphoneNotFound");
  }
  if (error instanceof DOMException && (error.name === "NotReadableError" || error.name === "AbortError")) {
    return resolveErrorMessage(language, `The ${labels.device} is busy or unavailable. Close other apps using it, check the device, then try again. Text notes remain available.`, kind === "camera" ? "noteUi.capture.cameraBusyOrUnavailable" : "noteUi.capture.microphoneBusyOrUnavailable");
  }
  return resolveErrorMessage(language, `The ${labels.device} is unavailable. Check browser site permissions and the device, then try again. Text notes remain available.`, kind === "camera" ? "noteUi.capture.cameraUnavailable" : "noteUi.capture.microphoneUnavailable");
}

export function browserMediaCapturePreflight(kind: MediaCaptureKind, hasRecorder?: boolean, language: AgencyLanguage = "en"): string | null {
  const message = mediaCapturePreflightMessage(kind, {
    secureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    hasRecorder,
  });
  return message ? resolveErrorMessage(language, message, kind === "camera" ? "noteUi.capture.cameraUnavailable" : "noteUi.capture.microphoneUnavailable") : null;
}
