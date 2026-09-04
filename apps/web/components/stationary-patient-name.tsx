"use client";

import type { EncounterDocument } from "@open-triage/contracts";
import {
  editStationaryScalarValue,
  STATIONARY_SCALAR_FIELDS,
  stationaryScalarValues,
} from "../app/stationary-scalar-group";

export function StationaryPatientName({ document, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const values = stationaryScalarValues(document);
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
      </div>
    </section>
  );
}
