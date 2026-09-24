"use client";

import type { AgencyMediaSettings } from "@open-triage/contracts";
import React, { FormEvent, useEffect, useState } from "react";
import { loadAgencyMediaSettings, updateAgencyMediaSettings } from "../app/admin-context";

const MEBIBYTE = 1024 * 1024;

export function showsStorageGrowthWarning(bytes: number, defaultBytes = 50 * MEBIBYTE): boolean {
  return Number.isFinite(bytes) && bytes > defaultBytes;
}

export function AgencySettingsPanel({ csrfToken, canWrite }: {
  readonly csrfToken: string;
  readonly canWrite: boolean;
}) {
  const [settings, setSettings] = useState<AgencyMediaSettings | null>(null);
  const [allowanceMib, setAllowanceMib] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadAgencyMediaSettings().then((loaded) => {
      if (!current) return;
      setSettings(loaded);
      setAllowanceMib(String(loaded.reportMediaAllowanceBytes / MEBIBYTE));
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Agency Settings could not be loaded.");
    });
    return () => { current = false; };
  }, []);

  const mib = Number(allowanceMib);
  const valid = Number.isInteger(mib) && mib >= 1 && mib <= 2048;
  const proposedBytes = valid ? mib * MEBIBYTE : 0;
  const warning = valid && showsStorageGrowthWarning(proposedBytes, settings?.defaultReportMediaAllowanceBytes);
  const unchanged = settings?.reportMediaAllowanceBytes === proposedBytes;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !valid || !canWrite) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateAgencyMediaSettings(csrfToken, {
        expectedRevision: settings.revision,
        reportMediaAllowanceBytes: proposedBytes,
      });
      setSettings(updated);
      setAllowanceMib(String(updated.reportMediaAllowanceBytes / MEBIBYTE));
      setNotice("Report media allowance saved and active for new captures.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agency Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-configuration agency-settings" aria-labelledby="agency-settings-heading">
    <div className="section-heading"><h2 id="agency-settings-heading">Agency Settings</h2></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="agency-settings-notice" role="status">{notice}</p>}
    {!settings && !error && <p role="status">Loading Agency Settings…</p>}
    {settings && <form onSubmit={save}>
      <label htmlFor="report-media-allowance">
        <strong>Report media allowance</strong>
        <span>Aggregate photo and audio storage available to each report.</span>
      </label>
      <div className="agency-settings-input">
        <input id="report-media-allowance" name="reportMediaAllowanceMib" type="number"
          min="1" max="2048" step="1" required disabled={!canWrite || busy}
          value={allowanceMib} onChange={(event) => setAllowanceMib(event.target.value)} />
        <span>MB</span>
      </div>
      <small>Allowed range: 1–2,048 MB. Default: 50 MB. Revision {settings.revision}.</small>
      {warning && <p className="agency-settings-warning" role="alert">
        Above 50 MB, report media increases Postgres database, WAL, replica, backup, restore, and vacuum storage growth. Confirm capacity planning before saving.
      </p>}
      {!canWrite && <p>You can view this setting, but changing it requires settings:write authority.</p>}
      {canWrite && <div className="form-actions">
        <button type="submit" disabled={busy || !valid || unchanged}>{busy ? "Saving…" : "Save"}</button>
      </div>}
    </form>}
  </section>;
}
