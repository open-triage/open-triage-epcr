# OpenTriage vendor dispatch contract 1.0.0

The OpenTriage dispatch message is a strict envelope around a **partial, NEMSIS 3.5.1 `EMSDataSet`-addressed dispatch snapshot**. It is not a complete NEMSIS patient-care report, NEMSIS XML document, or claim of full NEMSIS submission conformance. OpenTriage validates every supplied NEMSIS value, but version 1 deliberately requires only the operational fields needed to route and identify an assignment.

The executable contract artifacts are:

- [`dispatch-message.schema-1.0.0.json`](../packages/contracts/dispatch-message.schema-1.0.0.json)
- Ten distinct assignment fixtures: `synthetic-assignment-01.json` through `synthetic-assignment-10.json`
- [`synthetic-update.json`](../packages/contracts/examples/dispatch/synthetic-update.json)
- [`synthetic-cancellation.json`](../packages/contracts/examples/dispatch/synthetic-cancellation.json)

All people, identifiers, addresses, telephone numbers, and events in the examples are synthetic. The examples describe one stable `sourceRecordId` with revisions 1, 2, and 3.

## Envelope and identity rules

The envelope schema rejects unknown properties, unsupported schema or NEMSIS versions, non-positive revisions, malformed message UUIDs, and timestamps without an offset. `messageId` identifies one immutable delivery. `sourceRecordId` is the vendor's stable, opaque identity for one unit response and one patient; it is deliberately separate from the EMS response number in `eResponse.04`.

`instanceId` identifies one NEMSIS group instance and `occurrenceId` identifies one element value occurrence. Vendors MUST keep both stable across revisions. A non-root group instance MUST include `parentInstanceId` naming its immediate parent instance. These opaque identifiers are transport identities, are not OpenTriage UUIDs, and MUST NOT contain PHI.

The caller supplies organization and source-integration context outside the payload. Vendors cannot select an OpenTriage organization, form, catalog, assignment, report, or internal identifier through this message.

## Complete-snapshot lifecycle

Every message is the complete current vendor-owned snapshot for its `sourceRecordId`, not a patch. Begin with revision 1 and increase `revision` monotonically. A newer revision may skip a number, but OpenTriage records the gap. An older revision is stale. An exact retry is idempotent; reusing a `messageId` or a source-record revision with different canonical content is a conflict.

Omitting a previously supplied vendor-owned occurrence from a newer snapshot retracts it. Keep the same occurrence identity when changing a value. Coded values use `code` as authoritative; `display` is optional readability metadata and must agree with the pinned catalog when supplied. JSON whitespace, object-property order, and structural collection order do not define semantic equality; stable identities do.

Use `eventType: "upsert"` for assignment and update snapshots. Use `eventType: "cancel"` for cancellation and include the cancellation time in `eTimes.14`; a cancellation is not an empty tombstone. Reassignment to another unit is a cancellation of the old source record followed by a new revision-1 source record for the new response.

## Required assignment content

Every accepted assignment or update has concrete, non-null values for:

| NEMSIS identity | Meaning |
| --- | --- |
| `eResponse.03` | Dispatch incident number |
| `eResponse.04` | EMS response number |
| `eResponse.13` | Physical EMS vehicle number |
| `eResponse.14` | Agency-scoped unit call sign used for routing |
| `eTimes.02` | Dispatch notified date/time |
| `eTimes.03` | Unit notified by dispatch date/time |

`eDispatch.01` (dispatch reason) is optional. Other valid NEMSIS 3.5.1 EMS dataset content can be retained, but version 1 rejects unknown, custom, or namespaced element identities. OpenTriage generates `eRecord.01` when a clinician opens the report; a vendor does not send it as the source-record identity.

## Values, codes, attributes, and findings

Each supplied element must occur in its catalog-defined group, obey cardinality and datatype constraints, and use allowed codes, null values, pertinent negatives, and attributes. For example, the assignment contains two occurrences of repeatable `ePatient.18`; their `PhoneNumberType` values are the pinned NEMSIS home (`9913003`) and mobile (`9913005`) codes.

Invalid required envelope, identity, routing, or timing content rejects the revision atomically. Invalid optional content is retained in the immutable source artifact but excluded from the canonical clinical projection. The result is `applied_with_findings`; each finding identifies the JSON Pointer path and NEMSIS element ID when applicable. This partial acceptance does not weaken validation of accepted content.

Delivery and provenance metadata stay outside NEMSIS XML. Production source artifacts can contain protected health information and are subject to clinical-data access controls and retention policy; payload bodies must not be written to ordinary application logs.

## Future REST delivery

A future authenticated REST endpoint will accept exactly one dispatch-message JSON object as the request body with `Content-Type: application/json`. It will wrap the same ingestion and validation behavior used by file ingestion and distinguish created, replayed, quarantined, conflicting, invalid, and applied-with-findings outcomes. The endpoint URL, authentication, credential lifecycle, rate limits, and final HTTP status mapping are intentionally not part of contract 1.0.0.
