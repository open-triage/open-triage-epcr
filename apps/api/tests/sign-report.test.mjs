import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  SignReportValidationError,
  validateSignReportCommand
} from "../dist/reports/sign-report.validation.js";
import {
  SignReportService,
  unresolvedDispatchConflictFindings
} from "../dist/reports/sign-report.service.js";

test("sign commands require a revision, signer, and explicit attestation", () => {
  const command = {
    commandId: randomUUID(),
    expectedRevision: 7,
    signerId: randomUUID(),
    attestation: { meaning: "I authored and approve this clinical report" },
    actorPersona: "clinician",
    clientTime: "2026-08-30T14:30:00-04:00"
  };
  assert.deepEqual(validateSignReportCommand(command), command);
  assert.throws(() => validateSignReportCommand({ ...command, expectedRevision: -1, attestation: {} }),
    (error) => error instanceof SignReportValidationError &&
      error.findings.some((finding) => finding.includes("expectedRevision")) &&
      error.findings.some((finding) => finding.includes("attestation")));
});

test("unresolved dispatch differences block signing until disposition", () => {
  const findings = unresolvedDispatchConflictFindings([
    { id: "conflict-1", element_id: "eDispatch.01" }
  ]);
  assert.deepEqual(findings.map(({ severity, code, path }) => ({ severity, code, path })), [{
    severity: "error", code: "dispatch.unresolved-conflict", path: "dispatchConflicts.conflict-1"
  }]);
  assert.deepEqual(unresolvedDispatchConflictFindings([]), []);
});

test("signing does not require report occurrences for read-only configuration metadata", async () => {
  let fieldQuery = "";
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from forms.form_version")) {
      return [{ status: "published", catalog_release_id: "catalog-release" }];
    }
    if (normalized.includes("from forms.form_field")) {
      fieldQuery = normalized;
      return [
        {
          id: "metadata-field", stable_key: "dAgency.01", required: false,
          clinically_stored: false, catalog_element_identity_id: "agency-identity",
          custom_element_definition_id: null, min_occurs: 1, agency_required: false,
          agency_required_severity: null
        },
        {
          id: "clinical-field", stable_key: "ePatient.01", required: false,
          clinically_stored: true, catalog_element_identity_id: "patient-identity",
          custom_element_definition_id: null, min_occurs: 1, agency_required: false,
          agency_required_severity: null
        }
      ];
    }
    if (normalized.includes("from forms.form_rule")) return [];
    if (normalized.includes("from clinical.element_occurrence")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new SignReportService({}, {});

  const findings = await service.validateSemantics(manager, {
    id: "report-id", form_version_id: "form-version", catalog_release_id: "catalog-release"
  });

  assert.match(fieldQuery, /left join catalog\.analytics_element_mapping/);
  assert.deepEqual(findings.map(({ code, path }) => ({ code, path })), [{
    code: "catalog.cardinality", path: "$.fields.ePatient.01"
  }]);
});
