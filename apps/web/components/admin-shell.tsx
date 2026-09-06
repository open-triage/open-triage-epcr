"use client";

import type { AdminContext, ClinicianSession } from "@open-triage/contracts";
import React, { useEffect, useState } from "react";
import { loadAdminContext } from "../app/admin-context";
import { CatalogAuthoring } from "./catalog-authoring";

const deferredPanels = [
  "Users", "Roles", "Units", "Agency Profile", "Validation", "Appearance",
  "System Settings", "Configuration History", "Audit Log", "Integrations", "Advanced Dashboard"
] as const;

export function AdminShell({ session }: { readonly session: ClinicianSession }) {
  const [context, setContext] = useState<AdminContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const unavailableOffline = () => {
      if (!navigator.onLine) {
        setContext(null);
        setError("Admin mode is online-only. Reconnect to continue.");
        return true;
      }
      return false;
    };
    const wentOffline = () => { unavailableOffline(); };
    window.addEventListener("offline", wentOffline);
    if (unavailableOffline()) return () => {
      current = false;
      window.removeEventListener("offline", wentOffline);
    };
    loadAdminContext().then((loaded) => {
      if (current) setContext(loaded);
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Administration configuration is unavailable.");
    });
    return () => {
      current = false;
      window.removeEventListener("offline", wentOffline);
    };
  }, []);

  const owner = context?.owner ?? session.user;
  const organization = context?.organization ?? session.organization;

  return <main className="admin-shell" aria-labelledby="admin-heading">
    <header className="admin-heading">
      <p className="eyebrow">Installation administration</p>
      <h1 id="admin-heading">Dashboard</h1>
      <p>Signed in as {owner.displayName} for {organization.name}.</p>
    </header>

    {error && <p className="admin-error" role="alert">{error}</p>}
    {!context && !error && <p className="admin-loading" role="status">Loading active configuration…</p>}
    {context && <section className="admin-configuration" aria-labelledby="active-configuration-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Used by new reports</p><h2 id="active-configuration-heading">Active configuration</h2></div>
      </div>
      {context.activeConfiguration ? <dl>
        <div><dt>Element catalog</dt><dd>{context.activeConfiguration.catalog.standard} {context.activeConfiguration.catalog.version}</dd></div>
        <div><dt>Stationary form</dt><dd>{context.activeConfiguration.stationaryForm.name}, version {context.activeConfiguration.stationaryForm.version}</dd></div>
      </dl> : <p role="status">No active Stationary configuration is assigned to an operational unit.</p>}
    </section>}

    {context && <section className="admin-configuration" aria-labelledby="catalog-authoring-heading">
      <div className="section-heading"><div><p className="eyebrow">Configuration journey</p><h2 id="catalog-authoring-heading">Element catalog</h2></div></div>
      <CatalogAuthoring csrfToken={session.csrfToken ?? session.accessToken ?? ""} />
    </section>}

    <section className="admin-panels" aria-labelledby="admin-panels-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Administration structure</p><h2 id="admin-panels-heading">Other panels</h2></div>
      </div>
      <div className="admin-placeholder-grid">
        {deferredPanels.map((panel) => <section className="admin-placeholder" aria-labelledby={`admin-${panel.toLowerCase().replaceAll(" ", "-")}`} key={panel}>
          <h3 id={`admin-${panel.toLowerCase().replaceAll(" ", "-")}`}>{panel}</h3>
          <p><strong>Unavailable in this release.</strong> This panel is a non-interactive preview of the planned administration structure.</p>
        </section>)}
      </div>
    </section>
  </main>;
}
