"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import React, { useId, useState } from "react";
import {
  editScalarOccurrence,
  moveScalarOccurrence,
  removeScalarOccurrence,
  scalarOccurrences,
  stationaryDateTimeDefault,
  type ScalarControlPresentation,
  type ScalarValidationFinding,
} from "../app/stationary-scalar";
import { StationaryScalarControl } from "./stationary-scalar-control";
import { StationaryPickerLegend } from "./stationary-picker-label";

/** Generic repeated-value editor shared by all catalog scalar families. */
export function StationaryScalarOccurrences({ document, groupInstanceId, presentation, disabled = false, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly groupInstanceId: string;
  readonly presentation: ScalarControlPresentation;
  readonly disabled?: boolean;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const id = useId();
  const occurrences = scalarOccurrences(document, presentation.groupId, groupInstanceId, presentation.elementId);
  const [raw, setRaw] = useState<Readonly<Record<string, string | boolean>>>({});
  const [findings, setFindings] = useState<Readonly<Record<string, ReadonlyArray<ScalarValidationFinding>>>>({});
  const [addition, setAddition] = useState<string | boolean>(presentation.family === "boolean" ? false : "");
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
    <fieldset className="stationary-field-control stationary-multiple-picker stationary-scalar-occurrences" data-element-id={presentation.elementId} aria-describedby={`${id}-help`}>
      <StationaryPickerLegend label={presentation.label} tooltipId={`${id}-help`} tooltip={<>{presentation.elementId}: {presentation.help}</>} />
      {occurrences.map((value, index) => (
        <div className="stationary-scalar-occurrence" key={value.occurrenceId}>
          <StationaryScalarControl presentation={presentation} value={value} inputValue={raw[value.occurrenceId]} disabled={disabled}
            defaultDateTime={presentation.family === "datetime" ? stationaryDateTimeDefault(document, {
              groupId: presentation.groupId, groupInstanceId, excludedOccurrenceId: value.occurrenceId,
            }) : undefined}
            findings={findings[value.occurrenceId]} embedded
            onInput={(input) => {
              setRaw((current) => ({ ...current, [value.occurrenceId]: input }));
              setFindings((current) => ({ ...current, [value.occurrenceId]: [] }));
              if (presentation.family === "datetime") apply(value.occurrenceId, input);
            }}
            onBlur={(input) => apply(value.occurrenceId, input)} />
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
        <StationaryScalarControl presentation={presentation} inputValue={addition} findings={findings.new} disabled={disabled}
          defaultDateTime={presentation.family === "datetime" ? stationaryDateTimeDefault(document, {
            groupId: presentation.groupId, groupInstanceId,
          }) : undefined}
          embedded onInput={(input) => {
            setAddition(input);
            setFindings((current) => ({ ...current, new: [] }));
          }} onBlur={(input) => {
            const result = editScalarOccurrence(document, {
              groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, input,
            });
            setFindings((current) => ({ ...current, new: result.ok ? [] : result.findings }));
          }} />
        <button type="button" disabled={disabled} onClick={() => {
          const result = editScalarOccurrence(document, {
            groupId: presentation.groupId, groupInstanceId, elementId: presentation.elementId, input: addition,
          });
          if (!result.ok) return setFindings((current) => ({ ...current, new: result.findings }));
          setFindings((current) => ({ ...current, new: [] }));
          setAddition(presentation.family === "boolean" ? false : "");
          onDocumentChange(result.document);
        }}>Add {presentation.label}</button>
      </div>}
    </fieldset>
  );
}
