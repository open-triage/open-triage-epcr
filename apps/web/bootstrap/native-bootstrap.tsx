import React from "react";
import { createRoot } from "react-dom/client";
import { AndroidRuntimeGate } from "../components/android-runtime-gate";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import { NativeUiLoading } from "../components/native-ui-loading";
import "../app/styles.css";
import "../app/session-layout.css";

// These exports also let release validation exercise the parsers actually shipped in this bootstrap.
export { parseAndroidPairing } from "../app/android-pairing";
export { parseAndroidPairingQr } from "../app/android-scanner";


export function mount() {
  createRoot(document.getElementById("native-bootstrap")!).render(<AndroidRuntimeGate><NativeUiLoading /><ServiceWorkerRegistration /></AndroidRuntimeGate>);
}
if (typeof document !== "undefined") mount();
