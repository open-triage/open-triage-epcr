# Analytical privacy boundary

Status: **proposed — human privacy/security approval required before merge or production use**  
Policy version: `privacy-boundary-1.0.0-proposed`  
Catalog: NEMSIS EMSDataSet 3.5.1

This is the review artifact for ticket 039. Approval means approving all four
decisions below as one boundary: the identifying-element classification, HMAC
inputs, secret custody, and rotation procedure. Implementation and automated
tests do not constitute that approval.

## Proposed decisions

1. **Identifying classification.** The 43 elements in
   `packages/database/config/identifying-elements.json` are identifying. The
   default analyst views omit their values, unrestricted narrative, and
   `additional_identifying_elements`. All other catalog elements retain exact
   clinical values. Every custom element author must make an explicit
   `identifying` decision; the database validates projected occurrences against
   that immutable definition and routes identifying additions separately.
2. **HMAC inputs.** `patient_key` is lowercase hex HMAC-SHA-256 over this exact
   UTF-8, NUL-delimited sequence:
   `open-triage.patient-key.v1`, installation UUID, decimal key version,
   organization UUID, internal `clinical.patient.id` UUID. UUIDs are lowercase.
   The internal patient UUID—not MRN, name, date of birth, phone, email, or any
   NEMSIS value—is the source identifier. A caller cannot submit a patient key.
   Longitudinal linkage therefore requires the installation to reuse the same
   internal patient UUID for the same patient.
3. **Secret custody.** Each installation and version receives an independently
   generated random secret of at least 32 bytes. A deployment secret manager
   injects it only into the API and the separately authorized rotation job as
   `PATIENT_KEY_SECRET_BASE64`. `PATIENT_KEY_INSTALLATION_ID` and
   `PATIENT_KEY_VERSION` are non-secret configuration. The secret must not enter
   PostgreSQL, application responses, logs, images, source control, analytics,
   backups of the database, or analyst environments. Access is limited to the
   API runtime and the rotation operator; access and changes are audited in the
   deployment platform.
4. **Rotation.** Rotate annually during a maintenance window and immediately
   after suspected disclosure. Create a new independent secret, increment the
   positive integer version, suspend writes and analytical reads, take and
   verify a recoverable backup, run `npm run rotate:patient-keys -w
   @open-triage/database`, validate counts and role tests, then resume access.
   The rotation transaction locks every patient row and atomically updates the
   transactional key plus both private projections. It refuses rollback or
   reuse of an older version and is safe to replay at the active version. Keep
   the previous secret only in restricted escrow until the backup/restore and
   validation window closes, then destroy it according to the installation's
   key-destruction procedure. All online rows rotate together, preserving online
   longitudinal joins. Rotation intentionally breaks joins to previously exported
   keys; any exceptional cross-version linkage requires separately approved
   identified access.

## Identifying-element classification

The machine-enforced list is the JSON file named above; this table supplies the
review rationale. “Identifying” includes direct identity, identifying free text,
precise private location, signatures/attachments, source/account identifiers,
and contact details of patients or related people.

| Category | Elements | Rationale |
| --- | --- | --- |
| Workforce/person identifiers | `eCrew.01`, `eOther.08` | Identifies a crew member or report author. |
| Practitioner identity | `eHistory.02`–`eHistory.04` | Practitioner family, given, and middle names. |
| Callback contact | `eInjury.13` | Direct telephone contact data. |
| Unrestricted narrative | `eNarrative.01` | Free text can contain any direct identifier. |
| Attachments and signatures | `eOther.11`, `eOther.16`, `eOther.20`–`eOther.22` | Images, filenames, and signer names can directly identify people. |
| Patient identity/contact | `ePatient.01`–`ePatient.05`, `ePatient.17`–`ePatient.19`, `ePatient.21`, `ePatient.23` | Patient ID, names, address, birth date, phone, email, licence, and suffix. |
| Certification signer | `ePayment.06`, `ePayment.07` | Named individual signing certification. |
| Payer/account identifiers | `ePayment.09`, `ePayment.17`, `ePayment.18`, `ePayment.59` | Source-system, group, policy, and payer contact identifiers can link a record. |
| Insured/guardian identity | `ePayment.19`–`ePayment.21`, `ePayment.23`–`ePayment.26`, `ePayment.31` | Names, address, and phone of insured or related people. |
| Employment identity/contact | `ePayment.33`, `ePayment.34`, `ePayment.39` | Employer name, address, and phone can identify the patient. |
| Precise scene location | `eScene.11`, `eScene.13`, `eScene.15`, `eScene.20` | GPS, facility, street address, and directions reveal a private location. |

Exact clinical age and non-identifying clinical timestamps remain in the default
views; this policy does not generalize them. The classification is intentionally
conservative and must be reviewed again for each catalog release and whenever a
custom element is introduced or materially changed.

## Enforced database access contract

- `open_triage_analyst`: may read only `analytics.epcr`,
  `analytics.epcr_repeatable_element`, `analytics.element_dictionary`, and
  `analytics.agency`.
- `open_triage_identified_analyst`: may read those four views and the two explicit
  `*_identified` views. It still cannot read private projections, transactional
  tables, source patient UUIDs, integration queues, secrets, or audit history.
- Neither analyst role owns objects or can log in directly. Deployment login
  principals receive membership only after authorization and assume the group
  role. Integration tests assume each real group role and execute permitted and
  denied queries against PostgreSQL 15+.

## Approval record

Pending. The reviewer should record their name, role, date, approved policy
version and any required changes in the ticket or PR. Until then, the first
acceptance criterion is not met and the PR must not merge.
