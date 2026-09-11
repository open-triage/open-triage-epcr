"use client";

import type { ClinicianSession, SyntheticCallGenerationContext } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { fetchSyntheticCallGenerationContext, generateSyntheticCall } from "../app/assigned-calls";
import { sessionRequestToken } from "../app/clinician-session";
import { canGenerateSyntheticCall, canUseClinicalDemoDraftActions, selectedClinicalDemoUnit } from "../app/clinical-demo";
import type { ActiveDraftReport } from "../app/draft-report";
import { deleteDraftReport } from "../app/draft-report";
import { DEMO_CLEAR_EVENT, DEMO_POPULATE_EVENT } from "../app/demo-provenance";
import { clearShellState } from "../app/local-persistence";
import { removeOfflineReport } from "../app/offline-reports";

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
  const [context, setContext] = useState<SyntheticCallGenerationContext | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage(result.reused ? "Focused the existing unopened synthetic call." : "Synthetic call generated.");
      onGenerated(result.assignment.id, result.reused);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The synthetic call could not be generated.");
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
      setMessage("Synthetic draft deleted.");
      onDeleted();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The synthetic draft could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return <aside className="safety-notice clinical-demo-banner" role="note" aria-label="Clinical Demo tools">
    <strong>Clinical Demo</strong>
    <span>Synthetic tools affect demo records only.</span>
    {canGenerate && context.eligibleUnits.length === 0 && <span>No eligible active unit is assigned.</span>}
    {canGenerate && multipleUnits && <label className="clinical-demo-unit">
      Unit
      <select value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)}>
        <option value="">Select a unit</option>
        {context.eligibleUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.callSign} — {unit.name}</option>)}
      </select>
    </label>}
    {canGenerate && context.eligibleUnits.length > 0 && <button type="button" disabled={!targetUnitId || generating}
      onClick={() => void generate()}>{generating ? "Generating…" : "Generate call"}</button>}
    {canUseClinicalDemoDraftActions(activeReport) && <span className="demo-data-controls" role="group" aria-label="Demo record data">
      <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_POPULATE_EVENT))}>Populate</button>
      <button type="button" onClick={() => window.dispatchEvent(new Event(DEMO_CLEAR_EVENT))}>Clear</button>
      <button className="delete-record-action" type="button" disabled={deleting}
        onClick={() => void deleteRecord()}>{deleting ? "Deleting…" : "Delete"}</button>
    </span>}
    {message && <span role="status">{message}</span>}
  </aside>;
}
