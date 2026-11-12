"use client";
import { useEffect, useState } from "react";
import type { AndroidUpgradeClientPolicy } from "@open-triage/contracts/android-upgrade-policy";
import { isAndroidRuntime } from "../app/android-runtime";
import { loadAndroidClientPolicy } from "../app/android-client-policy";
import { authenticationInstallationGeneration, INSTALLATION_GENERATION_KEY } from "../app/installation-transition-generation";
import { applicationVisible } from "../app/application-foreground";
import { useVisiblePolling } from "./use-visible-polling";

export function useAndroidUpgradePolicy(scope: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{scope: string; policy: AndroidUpgradeClientPolicy | null} | null>(null);
  const [revision, setRevision] = useState(0);
  const native = isAndroidRuntime();
  // Authentication generation assertions intentionally throw during transitions;
  // rendering must remain available to show the locked/login workspace.
  let generationScope: string | null = null;
  try { generationScope = typeof window === "undefined" ? null : window.localStorage.getItem(INSTALLATION_GENERATION_KEY); }
  catch { generationScope = "storage-unavailable"; }
  const contextualScope = `${scope}:${generationScope}`;
  useVisiblePolling(() => setRevision(value => value + 1), 30_000, native && enabled, contextualScope);
  useEffect(() => {
    if (!native || !enabled || !applicationVisible()) return;
    const controller = new AbortController();
    let generation: string | null;
    try { generation = authenticationInstallationGeneration(); }
    catch { return; }
    const current = () => {
      if (controller.signal.aborted) return false;
      try { return generation === authenticationInstallationGeneration(); }
      catch { return false; }
    };
    void loadAndroidClientPolicy(controller.signal).then(policy => {
      if (current()) setSnapshot({scope: contextualScope, policy});
    }).catch(() => {
      if (current()) setSnapshot({scope: contextualScope, policy: null});
    });
    return () => controller.abort();
  }, [contextualScope, native, enabled, revision]);
  const policy = snapshot?.scope === contextualScope ? snapshot.policy : null;
  return { native, policy, newWorkBlocked: native && (!enabled || !policy || policy.status === "upgrade-required") };
}
