"use client";

import type { EncounterDocument, StationaryFormDraft } from "@open-triage/contracts";
import React, { useMemo, useState } from "react";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { configuredStationaryPreviewSections } from "../app/stationary-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { actionableStationaryFindings, validateStationaryRecord, type StationaryValidationFinding } from "../app/stationary-validation";
import { StationaryRecord } from "./stationary-record";

/** Creates a detached document; preview edits can never reach report persistence. */
export function createStationaryPreviewDocument(): EncounterDocument {
  return populateStationaryDemoData(structuredClone(syntheticEncounter.document));
}

/** Applies catalog validation only to the fields present in this draft. */
export function stationaryPreviewFindings(document: EncounterDocument, draft: StationaryFormDraft): ReadonlyArray<StationaryValidationFinding> {
  const fields = new Map(draft.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" ? [[field.source.elementId, field] as const] : [])));
  const groups = new Set(configuredStationaryPreviewSections(draft.definition).flatMap((section) => [...section.groupIds]));
  return validateStationaryRecord(document, { definition: draft.definition, catalogFields: draft.catalogFields ?? {} },
    new Date().toISOString()).filter((finding) => {
    const elementId = finding.target.fieldId ?? finding.target.elementId;
    if (!elementId) return groups.has(finding.target.groupId);
    const field = fields.get(elementId);
    if (!field) return false;
    return !(field.required === false && finding.id.startsWith("stationary:field.minimum:"));
  });
}

export function StationaryFormPreview({ draft, onReturn }: {
  readonly draft: StationaryFormDraft;
  readonly onReturn: () => void;
}) {
  const [document, setDocument] = useState(createStationaryPreviewDocument);
  const findings = useMemo(() => stationaryPreviewFindings(document, draft), [document, draft]);
  return <section className="stationary-form-preview" aria-labelledby="stationary-preview-heading">
    <header className="stationary-preview-heading">
      <div>
        <p className="eyebrow">Synthetic preview</p>
        <h3 id="stationary-preview-heading">Draft Stationary form</h3>
        <p>Interactive fictional data only. Changes here are temporary and never create or update a clinical report.</p>
      </div>
      <div className="form-actions">
        <button type="button" onClick={() => setDocument(createStationaryPreviewDocument())}>Reset synthetic data</button>
        <button type="button" onClick={onReturn}>Return to form draft</button>
      </div>
    </header>
    <StationaryRecord document={document} findings={actionableStationaryFindings(findings)} formDefinition={draft.definition}
      catalogFields={draft.catalogFields} onDocumentChange={setDocument} />
  </section>;
}
