"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { EncounterDocument, StationaryFormDraft } from "@open-triage/contracts";
import React, { useMemo, useState } from "react";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { configuredStationaryPreviewSections } from "../app/stationary-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { actionableStationaryFindings, validateStationaryRecord, type StationaryValidationFinding } from "../app/stationary-validation";
import { StationaryRecord } from "./stationary-record";
import { previewCatalogFields } from "../app/form-field-choices";

/** Creates a detached document; preview edits can never reach report persistence. */
export function createStationaryPreviewDocument(): EncounterDocument {
  return populateStationaryDemoData(structuredClone(syntheticEncounter.document));
}

/** Applies catalog validation only to the fields present in this draft. */
export function stationaryPreviewFindings(document: EncounterDocument, draft: StationaryFormDraft): ReadonlyArray<StationaryValidationFinding> {
  const fields = new Map(draft.definition.sections.flatMap((section) => section.fields.flatMap((field) =>
    field.source.kind === "nemsis" ? [[field.source.elementId, field] as const] : [])));
  const groups = new Set(configuredStationaryPreviewSections(draft.definition).flatMap((section) => [...section.groupIds]));
  return validateStationaryRecord(document, { definition: draft.definition,
    catalogFields: previewCatalogFields(draft.definition, draft.catalogFields ?? {}) },
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
  const t = useAdminText();
  const [document, setDocument] = useState(createStationaryPreviewDocument);
  const [language, setLanguage] = useState<"en" | "sv">("en");
  const findings = useMemo(() => stationaryPreviewFindings(document, draft), [document, draft]);
  const catalogFields = useMemo(() => previewCatalogFields(draft.definition, draft.catalogFields ?? {}), [draft]);
  return <section className="stationary-form-preview" aria-labelledby="stationary-preview-heading">
    <header className="stationary-preview-heading">
      <div>
        <p className="eyebrow"><AdminText messageKey="admin.syntheticPreview" /></p>
        <h3 id="stationary-preview-heading"><AdminText messageKey="admin.draftStationaryForm" /></h3>
        <p><AdminText messageKey="admin.interactiveFictionalData" /></p>
      </div>
      <div className="form-actions">
        <label htmlFor="form-preview-language"><AdminText messageKey="admin.previewLanguage" /></label><select id="form-preview-language" value={language} onChange={(event) => setLanguage(event.target.value as "en" | "sv")}><option value="en"><AdminText messageKey="admin.english" /></option><option value="sv"><AdminText messageKey="admin.swedish" /></option></select>
        <button type="button" onClick={() => setDocument(createStationaryPreviewDocument())}><AdminText messageKey="admin.resetSyntheticData" /></button>
        <button type="button" onClick={onReturn}><AdminText messageKey="admin.returnToForm" /></button>
      </div>
    </header>
    <StationaryRecord document={document} findings={actionableStationaryFindings(findings)} formDefinition={draft.definition}
      catalogFields={catalogFields} customFields={draft.customFields} customGroups={draft.customGroups} catalogGroups={draft.catalogGroups} language={language} onDocumentChange={setDocument} />
  </section>;
}
