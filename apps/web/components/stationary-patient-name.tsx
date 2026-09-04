"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import { useState } from "react";
import {
  editStationaryScalarSelection,
  STATIONARY_SCALAR_FIELDS,
  stationaryScalarValue,
} from "../app/stationary-scalar-group";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import type { ScalarValidationFinding } from "../app/stationary-scalar";
import { StationaryTextPicker } from "./stationary-text-picker";
import { editStationaryCodedValue, stationaryCodedField } from "../app/stationary-coded-value";
import { StationaryCodedValueField } from "./stationary-coded-field";

const sexField = stationaryCodedField("ePatient.25");

export function StationaryPatientName({ document, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const [findings, setFindings] = useState<Readonly<Record<string, ReadonlyArray<ScalarValidationFinding>>>>({});
  const patient = document.groups.find(({ id }) => id === "ePatientSection")?.instances[0];
  const sex = patient?.elements.find(({ id }) => id === sexField.elementId)?.values[0];
  return (
    <section className="stationary-scalar-group" aria-labelledby="stationary-patient-name-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Canonical patient-care group</p>
          <h1 id="stationary-patient-name-heading">Patient name</h1>
        </div>
        <span>ePatient.PatientNameGroup</span>
      </div>
      <div className="stationary-scalar-fields">
        {STATIONARY_SCALAR_FIELDS.map((field) => (
          <StationaryTextPicker
            key={field.id}
            presentation={field}
            catalog={requireNemsisDataElement(field.id)}
            value={stationaryScalarValue(document, field.id)}
            findings={findings[field.id]}
            onChange={(selection) => {
              const result = editStationaryScalarSelection(document, field.id, selection);
              if (!result.ok) return setFindings((current) => ({ ...current, [field.id]: result.findings }));
              setFindings((current) => ({ ...current, [field.id]: [] }));
              onDocumentChange(result.document);
            }}
          />
        ))}
        {patient && <StationaryCodedValueField
          field={sexField}
          value={sex}
          onChange={(selection) => onDocumentChange(editStationaryCodedValue(document, {
            groupId: "ePatientSection",
            instanceId: patient.instanceId,
            elementId: sexField.elementId,
            ...(sex ? { occurrenceId: sex.occurrenceId } : {}),
          }, selection))}
        />}
      </div>
    </section>
  );
}
