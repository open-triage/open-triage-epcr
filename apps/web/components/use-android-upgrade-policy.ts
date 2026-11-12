"use client";
import { useEffect, useState } from "react";
import type { AndroidUpgradeClientPolicy } from "@open-triage/contracts/android-upgrade-policy";
import { isAndroidRuntime } from "../app/android-runtime";
import { loadAndroidClientPolicy } from "../app/android-client-policy";
import { authenticationInstallationGeneration } from "../app/installation-transition-generation";
import { applicationVisible } from "../app/application-foreground";
import { useVisiblePolling } from "./use-visible-polling";

export function useAndroidUpgradePolicy(scope: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{scope: string; policy: AndroidUpgradeClientPolicy | null} | null>(null);
  const [revision, setRevision] = useState(0);
  const native = isAndroidRuntime();
  useVisiblePolling(() => setRevision(value => value + 1), 30_000, native && enabled, scope);
  useEffect(() => {
    if (!native || !enabled || !applicationVisible()) return;
    const controller = new AbortController();
    const generation = authenticationInstallationGeneration();
    void loadAndroidClientPolicy(controller.signal).then(policy => {
      if (!controller.signal.aborted && generation === authenticationInstallationGeneration()) setSnapshot({scope, policy});
    }).catch(() => {
      if (!controller.signal.aborted && generation === authenticationInstallationGeneration()) setSnapshot({scope, policy: null});
    });
    return () => controller.abort();
  }, [scope, native, enabled, revision]);
  const policy = snapshot?.scope === scope ? snapshot.policy : null;
  return { native, policy, newWorkBlocked: native && (!enabled || !policy || policy.status === "upgrade-required") };
}
