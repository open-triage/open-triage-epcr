"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import React, { useState } from "react";
import {
  editScalarOccurrence,
  editScalarSelection,
  moveScalarOccurrence,
  removeScalarOccurrence,
  scalarOccurrences,
  scalarSelectionOccurrences,
  type ScalarControlPresentation,
  type ScalarValidationFinding,
  type StationaryScalarSelection,
} from "../app/stationary-scalar";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { StationaryNumericPicker } from "./stationary-numeric-picker";
import { StationaryScalarControl } from "./stationary-scalar-control";

/** Generic repeated-value editor shared by all catalog scalar families. */
export function StationaryScalarOccurrences({ document, groupInstanceId, presentation, disabled = false, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groupInstanceId: string;
  readonly presentation: ScalarControlPresentation;
  readonly disabled?: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const numeric = presentation.family === "numeric" || presentation.family === "integer";
  const occurrences = numeric
    ? scalarSelectionOccurrences(document, presentation.groupId, groupInstanceId, presentation.elementId)
    : scalarOccurrences(document, presentation.groupId, groupInstanceId, presentation.elementId);
  const catalog = requireNemsisDataElement(presentation.elementId);
  const [raw, setRaw] = useState<Readonly<Record<string, string | boolean>>>({});
  const [findings, setFindings] = useState<Readonly<Record<string, ReadonlyArray<ScalarValidationFinding>>>>({});
  const [addition, setAddition] = useState<string | boolean>(presentation.family === "boolean" ? false : "");
  const [numericAddition, setNumericAddition] = useState<StationaryScalarSelection>();
  const canAdd = presentation.maximumOccurrences === "unbounded" || occurrences.length < presentation.maximumOccurrences;
  const apply = (occurrenceId: string, input: string | boolean) => {
    setRaw((current) => ({ ...current, [occurrenceId]: input }));
    const result = editScalarOccurrence(document, {
      groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, occurrenceId, input,
    });
    if (!result.ok) return setFindings((current) => ({ ...current, [occurrenceId]: result.findings }));
    setFindings((current) => ({ ...current, [occurrenceId]: [] }));
    setRaw((current) => { const next = { ...current }; delete next[occurrenceId]; return next; });
    onDocumentChange(result.document);
  };
  return (
    <div className="stationary-scalar-occurrences">
      {occurrences.map((value, index) => (
        <div className="stationary-scalar-occurrence" key={value.occurrenceId}>
          {numeric
            ? <StationaryNumericPicker presentation={presentation} catalog={catalog} value={value} disabled={disabled}
              findings={findings[value.occurrenceId]} onChange={(selection) => {
                const result = editScalarSelection(document, {
                  groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, occurrenceId: value.occurrenceId,
                  ...(selection ? { selection } : {}),
                });
                if (!result.ok) return setFindings((current) => ({ ...current, [value.occurrenceId]: result.findings }));
                setFindings((current) => ({ ...current, [value.occurrenceId]: [] }));
                onDocumentChange(result.document);
              }} />
            : <StationaryScalarControl presentation={presentation} value={value.kind === "scalar" ? value : undefined} inputValue={raw[value.occurrenceId]} disabled={disabled}
              findings={findings[value.occurrenceId]} onInput={(input) => apply(value.occurrenceId, input)} />}
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
        </div>
      ))}
      {presentation.repeatable && canAdd && <div className="stationary-scalar-occurrence stationary-scalar-addition">
        {numeric
          ? <StationaryNumericPicker key={`new-${occurrences.length}`} presentation={presentation} catalog={catalog} findings={findings.new} disabled={disabled}
            onChange={setNumericAddition} />
          : <StationaryScalarControl presentation={presentation} inputValue={addition} findings={findings.new} disabled={disabled}
            onInput={setAddition} />}
        {numeric
          ? <button type="button" disabled={disabled || !numericAddition} onClick={() => {
              if (!numericAddition) return;
              const result = editScalarSelection(document, {
                groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, selection: numericAddition,
              });
              if (!result.ok) return setFindings((current) => ({ ...current, new: result.findings }));
              setFindings((current) => ({ ...current, new: [] }));
              setNumericAddition(undefined);
              onDocumentChange(result.document);
            }}>Add {presentation.label}</button>
          : <button type="button" disabled={disabled} onClick={() => {
          const result = editScalarOccurrence(document, {
            groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, input: addition,
          });
          if (!result.ok) return setFindings((current) => ({ ...current, new: result.findings }));
          setFindings((current) => ({ ...current, new: [] }));
          setAddition(presentation.family === "boolean" ? false : "");
          onDocumentChange(result.document);
        }}>Add {presentation.label}</button>}
      </div>}
    </div>
  );
}
