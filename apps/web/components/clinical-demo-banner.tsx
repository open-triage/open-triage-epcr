"use client";

import type { ClinicianSession, SyntheticCallGenerationContext } from "@open-triage/contracts";
import { useEffect, useState } from "react";
import { fetchSyntheticCallGenerationContext, generateSyntheticCall } from "../app/assigned-calls";
import { sessionRequestToken } from "../app/clinician-session";
import { canGenerateSyntheticCall, selectedClinicalDemoUnit } from "../app/clinical-demo";

export function ClinicalDemoBanner({
  session,
  activeReport,
  refreshRequest,
  onGenerated,
}: {
  readonly session: ClinicianSession;
  readonly activeReport: boolean;
  readonly refreshRequest: number;
  readonly onGenerated: (assignmentId: string, reused: boolean) => void;
}) {
  const [context, setContext] = useState<SyntheticCallGenerationContext | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [generating, setGenerating] = useState(false);
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
  }, [activeReport, refreshRequest]);

  if (!authorized || !context) return null;
  const canGenerate = canGenerateSyntheticCall(activeReport, context);
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
    {message && <span role="status">{message}</span>}
  </aside>;
}
