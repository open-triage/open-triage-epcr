"use client";

import type { StationaryFormDraft } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { StationaryFormPreview } from "../../components/stationary-form-preview";

export default function AdminPreviewPage() {
  const [draft, setDraft] = useState<StationaryFormDraft | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = new URLSearchParams(window.location.search).get("draft");
      if (!key) return setError("No Stationary form preview was supplied.");
      const serialized = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (!serialized) return setError("This Stationary form preview has expired. Open it again from Administration.");
      try { setDraft(JSON.parse(serialized) as StationaryFormDraft); }
      catch { setError("The Stationary form preview could not be read."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (error) return <main className="admin-preview-error"><h1>Preview unavailable</h1><p role="alert">{error}</p></main>;
  if (!draft) return <main className="admin-preview-error"><p role="status">Loading Stationary form preview…</p></main>;
  return <main className="admin-preview-window">
    <StationaryFormPreview draft={draft} onReturn={() => window.close()} />
  </main>;
}
