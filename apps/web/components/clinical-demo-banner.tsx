"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { ClinicianSession, SyntheticCallGenerationContext } from "@open-triage/contracts";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchSyntheticCallGenerationContext, generateSyntheticCall } from "../app/assigned-calls";
import { sessionRequestToken } from "../app/clinician-session";
import { canGenerateSyntheticCall, canUseClinicalDemoDraftActions, selectedClinicalDemoUnit } from "../app/clinical-demo";
import type { ActiveDraftReport } from "../app/draft-report";
import { deleteDraftReport } from "../app/draft-report";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "../app/demo-provenance";
import { clearShellState } from "../app/local-persistence";
import { removeOfflineReport } from "../app/offline-reports";
import { protectedStorageStatus, subscribeProtectedStorageStatus } from "../app/protected-clinical-storage";

const NO_PROTECTED_REPORT_STATUS = { mode: "online-only", explanation: null } as const;

export function ClinicalDemoBanner({
  session,
  activeReport,
  refreshRequest,
  onGenerated,
  onDeleted,
}: {
  readonly session: ClinicianSession;
  readonly activeReport: ActiveDraftReport | null;
  readonly refreshRequest: number;
  readonly onGenerated: (assignmentId: string, reused: boolean) => void;
  readonly onDeleted: () => void;
}) {
  const t = useAdminText();
  const [context, setContext] = useState<SyntheticCallGenerationContext | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const protectedStatus = useSyncExternalStore(
    useCallback((changed) => subscribeProtectedStorageStatus((reportId) => {
      if (reportId === activeReport?.id) changed();
    }), [activeReport?.id]),
    useCallback(() => activeReport ? protectedStorageStatus(activeReport.id) : NO_PROTECTED_REPORT_STATUS, [activeReport]),
    () => NO_PROTECTED_REPORT_STATUS,
  );

  useEffect(() => {
    let current = true;
    void fetchSyntheticCallGenerationContext().then((loaded) => {
      if (!current) return;
      setContext(loaded);
      setAuthorized(true);
      setMessage(null);
      setSelectedUnitId((selected) => selectedClinicalDemoUnit(loaded.eligibleUnits, selected));
    }).catch(() => {
      if (current) {
        setContext(null);
        setAuthorized(false);
      }
    });
    return () => { current = false; };
  }, [activeReport?.id, refreshRequest]);

  if (!authorized || !context) return null;
  const canGenerate = canGenerateSyntheticCall(activeReport !== null, context);
  const multipleUnits = context.eligibleUnits.length > 1;
  const targetUnitId = multipleUnits ? selectedUnitId : context.eligibleUnits[0]?.id ?? "";

  async function generate() {
    if (!targetUnitId || generating) return;
    setGenerating(true);
    setMessage(null);
    try {
      const result = await generateSyntheticCall(sessionRequestToken(session), targetUnitId);
      setMessage(result.reused ? t("admin.focusedTheExisting") : t("admin.syntheticCallGenerated"));
      onGenerated(result.assignment.id, result.reused);
    } catch (reason) {
      setMessage(t("admin.syntheticCallGenerationFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function deleteRecord() {
    if (!canUseClinicalDemoDraftActions(activeReport) || deleting) return;
    const call = activeReport.callNumber ? ` for ${activeReport.callNumber}` : "";
    if (!window.confirm(`Permanently delete this synthetic draft${call}? This cannot be undone.`)) return;
    setDeleting(true);
    setMessage(null);
    try {
      await deleteDraftReport(sessionRequestToken(session), activeReport.id);
      clearShellState(window.localStorage, activeReport.id);
      removeOfflineReport(window.localStorage, activeReport.id);
      setMessage(t("admin.syntheticDraftDeleted"));
      onDeleted();
    } catch (reason) {
      setMessage(t("admin.syntheticDraftDeletionFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return <aside className="safety-notice clinical-demo-banner" role="note" aria-label={t("admin.clinicalDemoTools")}>
    <strong><AdminText messageKey="admin.clinicalDemo" /></strong>
    {protectedStatus.mode === "best-effort" && <span className="demo-storage-note"
      aria-label={`${t("admin.bestEffortOffline")}. ${protectedStatus.explanation ?? ""}`}
      title={protectedStatus.explanation ?? undefined}><AdminText messageKey="admin.bestEffortOffline" /></span>}
    {canGenerate && context.eligibleUnits.length === 0 && <span><AdminText messageKey="admin.noEligibleActive" /></span>}
    {canGenerate && multipleUnits && <label className="clinical-demo-unit">
      <AdminText messageKey="admin.unit" />
      <select value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)}>
        <option value=""><AdminText messageKey="admin.selectAUnit" /></option>
        {context.eligibleUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.callSign} — {unit.name}</option>)}
      </select>
    </label>}
    {canGenerate && context.eligibleUnits.length > 0 && <button type="button" disabled={!targetUnitId || generating}
      onClick={() => void generate()}>{generating ? t("admin.generating") : t("admin.generateCall")}</button>}
    {canUseClinicalDemoDraftActions(activeReport) && <span className="demo-data-controls" role="group" aria-label={t("admin.demoRecordData")}>
      <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_POPULATE_EVENT))}><AdminText messageKey="admin.populate" /></button>
      <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_CLEAR_EVENT))}><AdminText messageKey="admin.clear" /></button>
      <button className="delete-record-action" type="button" disabled={deleting}
        onClick={() => void deleteRecord()}>{deleting ? t("admin.deleting") : t("admin.delete")}</button>
    </span>}
    {message && <span role="status">{message}</span>}
  </aside>;
}
