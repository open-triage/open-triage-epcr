"use client";

import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import React, { useState } from "react";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import {
  editScalarSelection,
  moveScalarOccurrence,
  removeScalarOccurrence,
  scalarElementValues,
  type ScalarControlPresentation,
  type ScalarValidationFinding,
  type StationaryScalarSelection,
} from "../app/stationary-scalar";
import { StationaryTextPicker } from "./stationary-text-picker";

/** Repeatable text editor that keeps ordinary and exceptional occurrences in one ordered list. */
export function StationaryTextOccurrences({ document, groupInstanceId, presentation, disabled = false, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groupInstanceId: string;
  readonly presentation: ScalarControlPresentation;
  readonly disabled?: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const catalog = requireNemsisDataElement(presentation.elementId);
  const occurrences = scalarElementValues(document, presentation.groupId, groupInstanceId, presentation.elementId);
  const [findings, setFindings] = useState<Readonly<Record<string, ReadonlyArray<ScalarValidationFinding>>>>({});
  const [addition, setAddition] = useState<StationaryScalarSelection>();
  const additionValue: EncounterValue | undefined = addition?.kind === "scalar"
    ? { kind: "scalar", occurrenceId: "new", value: addition.input }
    : addition?.kind === "pertinent-negative"
      ? { kind: "pertinent-negative", occurrenceId: "new", code: addition.code, ...(addition.display ? { display: addition.display } : {}) }
      : addition
        ? { kind: "null", occurrenceId: "new", ...(addition.code ? { notValue: { code: addition.code, ...(addition.display ? { display: addition.display } : {}) } } : {}) }
        : undefined;
  const canAdd = presentation.maximumOccurrences === "unbounded" || occurrences.length < presentation.maximumOccurrences;
  const apply = (occurrenceId: string, selection: StationaryScalarSelection | undefined) => {
    const result = editScalarSelection(document, {
      groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, occurrenceId,
      ...(selection ? { selection } : {}),
    });
    if (!result.ok) return setFindings((current) => ({ ...current, [occurrenceId]: result.findings }));
    setFindings((current) => ({ ...current, [occurrenceId]: [] }));
    onDocumentChange(result.document);
  };
  return <div className="stationary-scalar-occurrences stationary-text-occurrences">
    {occurrences.map((value, index) => <div className="stationary-scalar-occurrence" key={value.occurrenceId}>
      <StationaryTextPicker presentation={presentation} catalog={catalog} value={value} disabled={disabled}
        findings={findings[value.occurrenceId]} onChange={(selection) => apply(value.occurrenceId, selection)} />
      {presentation.repeatable && <div className="stationary-occurrence-actions" aria-label={`${presentation.label} occurrence actions`}>
        <button type="button" disabled={disabled || index === 0} onClick={() => {
          const result = moveScalarOccurrence(document, presentation.groupId, groupInstanceId, presentation.elementId, value.occurrenceId, index - 1);
          if (result.ok) onDocumentChange(result.document);
        }}>Move up</button>
        <button type="button" disabled={disabled || index === occurrences.length - 1} onClick={() => {
          const result = moveScalarOccurrence(document, presentation.groupId, groupInstanceId, presentation.elementId, value.occurrenceId, index + 1);
          if (result.ok) onDocumentChange(result.document);
        }}>Move down</button>
        <button type="button" disabled={disabled} onClick={() => {
          const result = removeScalarOccurrence(document, presentation.groupId, groupInstanceId, presentation.elementId, value.occurrenceId);
          if (result.ok) onDocumentChange(result.document);
          else setFindings((current) => ({ ...current, [value.occurrenceId]: result.findings }));
        }}>Remove</button>
      </div>}
    </div>)}
    {presentation.repeatable && canAdd && <div className="stationary-scalar-occurrence stationary-scalar-addition">
      <StationaryTextPicker presentation={presentation} catalog={catalog}
        value={additionValue}
        findings={findings.new} disabled={disabled} onChange={setAddition} />
      <button type="button" disabled={disabled || !addition} onClick={() => {
        const result = editScalarSelection(document, {
          groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId,
          ...(addition ? { selection: addition } : {}),
        });
        if (!result.ok) return setFindings((current) => ({ ...current, new: result.findings }));
        setFindings((current) => ({ ...current, new: [] }));
        setAddition(undefined);
        onDocumentChange(result.document);
      }}>Add {presentation.label}</button>
    </div>}
  </div>;
}
