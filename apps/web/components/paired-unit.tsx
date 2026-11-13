"use client";

import { useState } from "react";
import { browserRequestConfiguration } from "../app/browser-api";
import { installationRequest, type InstallationSummary } from "../app/installation-enrollment";
import { resolveMessage } from "../app/localization";
import { useVisiblePolling } from "./use-visible-polling";

export function PairedUnit({ language }: { language: string }) {
  const [unitName, setUnitName] = useState<string | null>(null);
  useVisiblePolling(async () => {
    if (navigator.onLine === false) return;
    try {
      const result = await installationRequest<{enrolled:boolean;installation?:InstallationSummary}>("current");
      setUnitName(result.enrolled ? result.installation?.unitName ?? null : null);
    } catch { /* Keep the last known pairing during a connection failure. */ }
  }, 10_000, browserRequestConfiguration().mode === "server");
  return unitName ? <span className="session-paired-unit">{resolveMessage(language, "navigation.pairedUnit", {name:unitName})}</span> : null;
}
