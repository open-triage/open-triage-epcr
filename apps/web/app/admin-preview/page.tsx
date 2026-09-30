"use client";

import type { StationaryFormDraft } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { StationaryFormPreview } from "../../components/stationary-form-preview";
import { loadInstallationConfiguration } from "../installation-settings";
import { AdminLanguageContext, AdminText, useAdminText } from "../admin-localization";
import type { AgencyLanguage } from "../localization";

export default function AdminPreviewPage() {
  const [draft, setDraft] = useState<StationaryFormDraft | null>(null);
  const [error, setError] = useState("");
  const [agencyLanguage, setAgencyLanguage] = useState<AgencyLanguage>("en");

  useEffect(() => { void loadInstallationConfiguration().then((config) => setAgencyLanguage(config.settings.language)).catch(() => {}); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = new URLSearchParams(window.location.search).get("draft");
      if (!key) return setError("admin.stationaryFormPreviewMissing");
      const serialized = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (!serialized) return setError("admin.stationaryFormPreviewExpired");
      try { setDraft(JSON.parse(serialized) as StationaryFormDraft); }
      catch { setError("admin.stationaryFormPreviewReadFailed"); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return <AdminLanguageContext.Provider value={agencyLanguage}><PreviewContent draft={draft} error={error} />
    </AdminLanguageContext.Provider>;
}

function PreviewContent({ draft, error }: { readonly draft: StationaryFormDraft | null; readonly error: string }) {
  const t = useAdminText();
  if (error) return <main className="admin-preview-error"><h1><AdminText messageKey="admin.previewUnavailable" /></h1><p role="alert">{t(error)}</p></main>;
  if (!draft) return <main className="admin-preview-error"><p role="status"><AdminText messageKey="admin.loadingStationaryFormPreview" /></p></main>;
  return <main className="admin-preview-window">
    <StationaryFormPreview draft={draft} onReturn={() => window.close()} />
  </main>;
}
