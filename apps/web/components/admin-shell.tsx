"use client";

import type { AdminContext, AdminPanelKey, ClinicianSession } from "@open-triage/contracts";
import React, { useEffect, useState } from "react";
import { loadAdminContext } from "../app/admin-context";
import { CatalogAuthoring } from "./catalog-authoring";
import { StationaryFormAuthoring } from "./stationary-form-authoring";
import { ValidationAuthoring } from "./validation-authoring";
import { RolesPanel, UsersPanel } from "./admin-directory";

type AdminPanel = "Dashboard" | "Users" | "Roles" | "Element catalog" | "Stationary form" | "Validation rules";
const panelDefinition: ReadonlyArray<readonly [AdminPanelKey, AdminPanel]> = [
  ["dashboard", "Dashboard"], ["users", "Users"], ["roles", "Roles"],
  ["catalog", "Element catalog"], ["forms", "Stationary form"], ["validation", "Validation rules"]
];

function formattedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function AdminShell({ session }: {
  readonly session: ClinicianSession;
}) {
  const [context, setContext] = useState<AdminContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formCatalogReleaseId, setFormCatalogReleaseId] = useState("");
  const [activePanel, setActivePanel] = useState<AdminPanel | null>(null);

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
      if (current) {
        setContext(loaded);
        const authorized = panelDefinition.filter(([key]) => loaded.panels.includes(key)).map(([, panel]) => panel);
        setActivePanel((selected) => selected && authorized.includes(selected) ? selected : authorized[0] ?? null);
      }
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Administration configuration is unavailable.");
    });
    return () => {
      current = false;
      window.removeEventListener("offline", wentOffline);
    };
  }, [session]);

  const organization = context?.organization ?? session.organization;
  const panels = context ? panelDefinition.filter(([key]) => context.panels.includes(key)).map(([, panel]) => panel) : [];

  return <main className="admin-shell" aria-labelledby="admin-heading">
    <header className="admin-heading">
      <h1 id="admin-heading">Administration</h1>
      <p>{organization.name}</p>
    </header>

    <div className="admin-workspace">
      <nav className="admin-tabs" aria-label="Administration panels">
        {panels.map((panel) => <button type="button" key={panel}
          className={panel === activePanel ? "active" : ""} aria-current={panel === activePanel ? "page" : undefined}
          onClick={() => setActivePanel(panel)}>{panel}</button>)}
      </nav>
      <div className="admin-panel" aria-live="polite">
    {error && <p className="admin-error" role="alert">{error}</p>}
    {!context && !error && <p className="admin-loading" role="status">Loading active configuration…</p>}
    {context?.dashboard && activePanel === "Dashboard" && <section className="admin-configuration" aria-labelledby="active-configuration-heading">
      <div className="section-heading">
        <h2 id="active-configuration-heading">Active configuration</h2>
      </div>
      {context.activeConfiguration ? <dl>
        <div><dt>Element catalog</dt><dd>{context.activeConfiguration.catalog.name}</dd></div>
        <div><dt>Stationary form</dt><dd>{context.activeConfiguration.stationaryForm.name}, version {context.activeConfiguration.stationaryForm.version}</dd></div>
      </dl> : <p role="status">No active Stationary configuration is assigned to an operational unit.</p>}
      <div className="section-heading"><h2>Operations</h2></div>
      <dl className="admin-dashboard-metrics">
        <div><dt>Available calls</dt><dd>{context.dashboard.availableCalls}</dd></div>
        <div><dt>Ongoing reports</dt><dd>{context.dashboard.ongoingReports}</dd></div>
        <div><dt>Signed reports</dt><dd>{context.dashboard.signedReports}</dd><small>{context.dashboard.signedLast24Hours} in the last 24 hours</small></div>
        <div><dt>Reports with errors</dt><dd>{context.dashboard.reportsWithErrors}</dd></div>
        <div><dt>Active users</dt><dd>{context.dashboard.activeUsers}</dd></div>
        <div><dt>Active units</dt><dd>{context.dashboard.activeUnits}</dd></div>
      </dl>
      <div className="section-heading"><h2>System</h2></div>
      <dl className="admin-dashboard-metrics">
        <div><dt>API</dt><dd>Operational</dd></div>
        <div><dt>Database storage</dt><dd>{formattedBytes(context.dashboard.databaseSizeBytes)}</dd></div>
        <div><dt>Database connections</dt><dd>{context.dashboard.databaseConnections} / {context.dashboard.maxDatabaseConnections}</dd>
          <small>{Math.round(context.dashboard.databaseConnections / Math.max(context.dashboard.maxDatabaseConnections, 1) * 100)}% utilized</small></div>
        <div><dt>Measured</dt><dd><time dateTime={context.dashboard.generatedAt}>{new Date(context.dashboard.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></dd></div>
      </dl>
    </section>}

    {context && activePanel === "Users" && <UsersPanel
      canCreate={context.capabilities?.includes("users:write") ?? false}
      canManage={context.capabilities?.includes("users:write") ?? false}
      canAssignRoles={context.capabilities?.includes("roles:assign") ?? false}
      canViewSessions={(context.capabilities?.includes("users:read") && context.capabilities.includes("sessions:read")) ?? false}
      canRevokeSessions={(context.capabilities?.includes("users:read") && context.capabilities.includes("sessions:read") &&
        context.capabilities.includes("sessions:revoke")) ?? false}
      canResetCredentials={(context.capabilities?.includes("users:read") && context.capabilities.includes("credentials:reset")) ?? false}
      currentUserId={session.user.id}
      csrfToken={session.csrfToken ?? session.accessToken ?? ""} />}
    {context && activePanel === "Roles" && <RolesPanel csrfToken={session.csrfToken ?? session.accessToken ?? ""}
      capabilities={context.capabilities} />}

    {context && activePanel === "Element catalog" && <section className="admin-configuration" aria-labelledby="catalog-authoring-heading">
      <div className="section-heading"><h2 id="catalog-authoring-heading">Element catalog</h2></div>
      <CatalogAuthoring csrfToken={session.csrfToken ?? session.accessToken ?? ""} capabilities={context.capabilities}
        onPublished={setFormCatalogReleaseId} />
    </section>}

    {context && activePanel === "Stationary form" && <section className="admin-configuration" aria-labelledby="form-authoring-heading">
      <div className="section-heading"><h2 id="form-authoring-heading">Stationary form</h2></div>
      <StationaryFormAuthoring csrfToken={session.csrfToken ?? session.accessToken ?? ""}
        capabilities={context.capabilities}
        catalogReleaseId={formCatalogReleaseId || context.activeConfiguration?.catalog.id || ""}
        preferredCatalogReleaseId={formCatalogReleaseId}
        onActivated={() => { loadAdminContext().then(setContext).catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "The active configuration could not be refreshed.")); }} />
    </section>}

    {context && activePanel === "Validation rules" && <section className="admin-configuration" aria-labelledby="validation-authoring-heading">
      <div className="section-heading"><h2 id="validation-authoring-heading">Validation rules</h2></div>
      <ValidationAuthoring csrfToken={session.csrfToken ?? session.accessToken ?? ""}
        capabilities={context.capabilities} catalogReleaseId={context.activeConfiguration?.catalog.id || ""}
        onActivated={() => { loadAdminContext().then(setContext).catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "The active configuration could not be refreshed.")); }} />
    </section>}

      </div>
    </div>
  </main>;
}
