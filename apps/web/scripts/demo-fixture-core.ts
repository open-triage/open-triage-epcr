import { createHash } from "node:crypto";
import type { AssignedCallsResponse, EncounterDocument, OpenAssignmentResponse, OpenCallsResponse } from "@open-triage/contracts";
import { projectDispatchAssignment } from "../../api/src/dispatch/dispatch-assignment.projection.js";
import {
  validateDispatchAssignment,
  type DispatchValidationCatalog,
} from "../../api/src/dispatch/dispatch-assignment.validation.js";
import { DEMO_CLINICIAN_ID } from "../app/demo-identity.js";

type JsonRecord = Record<string, unknown>;

export type GeneratedDemoFixtures = {
  readonly assignedCalls: AssignedCallsResponse & { readonly generatedFrom: DemoFixtureSource };
  readonly openAssignment: OpenAssignmentResponse & { readonly generatedFrom: DemoFixtureSource };
  readonly openCalls: OpenCallsResponse & { readonly generatedFrom: DemoFixtureSource };
  readonly encounterDocument: EncounterDocument;
};

type DemoFixtureSource = {
  readonly path: "packages/contracts/examples/dispatch/synthetic-assignment.json";
  readonly sha256: string;
};

function stableUuid(namespace: string, identity: string): string {
  const bytes = createHash("sha256").update(`${namespace}\0${identity}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Pure static-demo projection. The accepted dispatch sample is its only clinical/operational input. */
export function buildDemoFixtures(
  input: unknown,
  catalog: DispatchValidationCatalog,
  sourceBytes: Uint8Array,
): GeneratedDemoFixtures {
  const validation = validateDispatchAssignment(input, catalog);
  if (!validation.canonical) {
    throw new TypeError(`Committed initial dispatch sample is invalid: ${validation.findings.map(({ pointer, message }) => `${pointer} ${message}`).join("; ")}`);
  }
  const canonical = validation.canonical;
  const projection = projectDispatchAssignment(canonical);
  const sentAt = typeof canonical.sentAt === "string" ? canonical.sentAt : projection.unitNotifiedAt;
  const source = {
    path: "packages/contracts/examples/dispatch/synthetic-assignment.json",
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  } as const;
  const assignmentId = stableUuid("static-demo-assignment", projection.sourceRecordId);
  const reportId = stableUuid("static-demo-report", projection.sourceRecordId);
  const unitId = stableUuid("static-demo-unit", projection.callSign);
  const projectedGroups = [
    ...(structuredClone(canonical.groups) as EncounterDocument["groups"]),
    {
      id: "eCrew.CrewGroup",
      instances: [{
        instanceId: `${projection.sourceRecordId}:demo-crew`,
        elements: [{
          id: "eCrew.01",
          values: [{ kind: "scalar" as const, occurrenceId: `${projection.sourceRecordId}:demo-crew-member`, value: projection.callSign }],
        }],
      }],
    },
  ];
  const encounterDocument: EncounterDocument = {
    $schema: "./encounter-document.schema-1.0.0.json",
    documentType: "open-triage.encounter",
    modelVersion: "1.1.0",
    dataModel: canonical.dataModel as EncounterDocument["dataModel"],
    formProfile: { id: "standard-encounter-v1", version: "1" },
    encounter: { id: reportId, createdAt: sentAt, updatedAt: sentAt, synthetic: true },
    groups: projectedGroups,
  };
  const assignedCall = {
    id: assignmentId,
    callNumber: projection.incidentNumber,
    unit: { id: unitId, callSign: projection.callSign },
    dispatchedAt: projection.unitNotifiedAt,
    dispatchReason: projection.dispatchReason,
    chiefComplaint: null,
    agencyTimeZone: "America/New_York",
    status: "assigned" as const,
  };
  return {
    assignedCalls: { assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: sentAt, generatedFrom: source },
    openAssignment: {
      assignmentId,
      report: {
        id: reportId,
        documentingUserId: DEMO_CLINICIAN_ID,
        formVersionId: stableUuid("static-demo-form", "standard-encounter-v1:1"),
        catalogReleaseId: stableUuid("static-demo-catalog", "NEMSIS:3.5.1:EMSDataSet"),
        revision: 0,
        status: "draft",
        document: encounterDocument,
        agencyTimeZone: "America/New_York",
        dispatchConflicts: [],
        dispatchCancellation: null,
      },
      replacementAssignment: null,
      generatedFrom: source,
    },
    openCalls: { openCalls: [], completedReportIds: [], refreshedAt: sentAt, generatedFrom: source },
    encounterDocument,
  };
}
