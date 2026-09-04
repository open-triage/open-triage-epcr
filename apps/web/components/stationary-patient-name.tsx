"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import { useState } from "react";
import {
  editStationaryScalarValue,
  STATIONARY_SCALAR_FIELDS,
  stationaryScalarValues,
} from "../app/stationary-scalar-group";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { validateScalarInput, type ScalarValidationFinding } from "../app/stationary-scalar";
import { StationaryScalarControl } from "./stationary-scalar-control";
import { editStationaryCodedValue, stationaryCodedField } from "../app/stationary-coded-value";
import { StationaryCodedValueField } from "./stationary-coded-field";

const sexField = stationaryCodedField("ePatient.25");

export function StationaryPatientName({ document, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const values = stationaryScalarValues(document);
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
          <StationaryScalarControl
            key={field.id}
            presentation={field}
            value={values[field.id] === undefined ? undefined : {
              kind: "scalar", occurrenceId: field.id, value: values[field.id]!,
            }}
            findings={findings[field.id]}
            onInput={(input) => {
              const nextFindings = validateScalarInput(requireNemsisDataElement(field.id), input);
              setFindings((current) => ({ ...current, [field.id]: nextFindings }));
              if (!nextFindings.length) onDocumentChange(editStationaryScalarValue(document, field.id, String(input)));
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
