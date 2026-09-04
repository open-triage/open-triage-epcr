"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import {
  editStationaryScalarValue,
  STATIONARY_SCALAR_FIELDS,
  stationaryScalarValues,
} from "../app/stationary-scalar-group";
import { editStationaryCodedValue, stationaryCodedField } from "../app/stationary-coded-value";
import { StationaryCodedValueField } from "./stationary-coded-field";

const sexField = stationaryCodedField("ePatient.25");

export function StationaryPatientName({ document, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const values = stationaryScalarValues(document);
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
          <label key={field.id}>
            <span>{field.label} <small>{field.id}</small></span>
            <input
              type="text"
              value={values[field.id] ?? ""}
              minLength={field.minLength || undefined}
              maxLength={field.maxLength}
              aria-describedby={`${field.id}-help`}
              onChange={(event) => onDocumentChange(editStationaryScalarValue(document, field.id, event.target.value))}
            />
            <small id={`${field.id}-help`}>{field.help}</small>
          </label>
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
