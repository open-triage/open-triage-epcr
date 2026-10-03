"use client";

import { useEffect, useState } from "react";
import type { ClinicianSession, PublicInstallationConfiguration } from "@open-triage/contracts";
import { ReviewShell } from "../../components/review-shell";
import { apiRequestUrl, browserRequestInit } from "../browser-api";
import { loadClinicianSession, authenticateRestartedClinicianSession } from "../clinician-session";
import { applyAgencyAppearance, loadInstallationConfiguration } from "../installation-settings";
import { RegionalFormatContext } from "../regional-format";
import { AgencyTimeZoneContext } from "../agency-time-zone";
import { resolveMessage } from "../localization";

const noAttentionRefresh = () => {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ReviewCallPage() {
  const [session, setSession] = useState<ClinicianSession | null>(null);
  const [installation, setInstallation] = useState<PublicInstallationConfiguration | null>(null);
  const [call, setCall] = useState<{ reportId: string; itemId?: string; dataset: "real" | "synthetic" } | null>(null);
  const [language, setLanguage] = useState("en");
  const [online, setOnline] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline(); window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline);
    const query = new URLSearchParams(window.location.search);
    const reportId = query.get("report") ?? "", itemId = query.get("item") ?? undefined;
    const dataset = query.get("dataset");
    if (!uuid.test(reportId) || (itemId && !uuid.test(itemId)) || !["real", "synthetic"].includes(dataset ?? "")) {
      queueMicrotask(() => { if (active) setFailed(true); });
    } else {
      const stored = loadClinicianSession(window.localStorage);
      const loadSession = stored ? authenticateRestartedClinicianSession(stored) : (async () => {
        const url = apiRequestUrl("/api/sessions/current");
        if (!url) return null;
        const response = await fetch(url, browserRequestInit());
        if (!response.ok) return null;
        return response.json() as Promise<ClinicianSession>;
      })();
      void Promise.all([loadSession, loadInstallationConfiguration()]).then(([authenticated, configuration]) => {
        if (!active) return;
        if (!authenticated?.capabilities?.some((value) => value === "review:all" || value === "review:self")) { setFailed(true); return; }
        const selectedLanguage = query.get("language") ?? configuration.settings.language;
        applyAgencyAppearance(configuration.appearance, document, selectedLanguage);
        setLanguage(selectedLanguage); setSession(authenticated); setInstallation(configuration);
        setCall({ reportId, itemId, dataset: dataset as "real" | "synthetic" });
      }).catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);
  if (failed) return <main className="review-workspace"><p role="alert">{resolveMessage(language, "review.detailUnavailable")}</p></main>;
  if (!session || !installation || !call) return <main className="review-workspace"><p role="status">{resolveMessage(language, "review.detailLoading")}</p></main>;
  return <RegionalFormatContext.Provider value={installation.settings.regionalFormat ?? "en-US"}>
    <AgencyTimeZoneContext.Provider value={installation.settings.timeZone ?? null}>
      <ReviewShell session={session} language={language} online={online} attention={null} onAttentionRefresh={noAttentionRefresh} callWindow={call} />
    </AgencyTimeZoneContext.Provider>
  </RegionalFormatContext.Provider>;
}
