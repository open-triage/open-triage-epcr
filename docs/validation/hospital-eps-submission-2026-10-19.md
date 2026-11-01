# Fictional EPS submission acceptance, 19 October 2026

Ticket009 live acceptance is recorded separately from deterministic local tests.
The operator explicitly authorized this public hackathon submission and supplied
the team credential through protected local configuration. No credential appears
in this evidence or source. The credential was encrypted by the normal EPS Admin
configuration command, verified through the read-only Organization/$me operation,
and activated with its tested canonical mapping revision.

## Exact signed input

A dedicated disposable installation used ordinary organization/owner setup, normal
protected role provisioning, the existing synthetic report generator, normal draft
saving with Demo capability and CSRF, and ordinary report signing validation.
No signing or authorization checks were bypassed.

The selected report is explicitly fictional. Its configured patient identity is
`urn:opentriage:fictional:acceptance | FICTIONAL-EPS-009-20261019`. The only outgoing
clinical mapping selects signed `eNarrative.01` into the EPS Patient story section.
The story explicitly identifies itself as a fictional hackathon acceptance record.
The five required clinical sections are marked unavailable. Required missing
patient demographics use EPS/IPS data-absent-reason; no patient name is invented.

- Signed report: `f5748a23-935f-4a3c-a1a4-4b199f5b4e3f`.
- Signed snapshot: `d5d79044-0100-4acf-a1ee-485304a1f4fc`, amendment sequence0.
- Prepared submission: `233dca0d-9cd6-4620-9145-bff676e2c8f3`.
- Configuration revision5; mapping SHA256 `7685f56f51fdd9e0571c9c70e5fee5011549706b09c0230321017fb953ff1a05`.
- Exact payload SHA256 `52d6d553f7d25290945494549a28e42110d70a6749a5bb1b73270807517c976a`.

The actual pinned HL7 validator7.0.2 checked the generated document against
`hl7.fhir.eu.eps#1.0.0-ballot`, FHIR R4 4.0.1, and the published dependency graph
before the deliberate submission. The local terminology server was disabled;
local profile validation is not a claim of complete terminology acceptance.
A separate actual-validator regression rejects a broken patient reference.

## Public receiver result

The exact preview was submitted once through the normal authorized submission
command. At `2026-10-19T14:54:35Z` (16:54 Europe/Stockholm), the public service
returned an OperationOutcome with informational issues and:

| Evidence | Observed value |
| --- | --- |
| State | accepted |
| X-Pass | true |
| X-Errors | 0 |
| X-Document-Type | eps |
| X-Document-Profile | http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps |
| X-Submission-Score | 52 |
| X-Score | 72 |
| X-Sections | 0 |
| X-Resources | 1 |

The service counts structured section entries separately from narrative. This
acceptance document intentionally uses faithful signed narrative and explicit
missing-data sections; the score does not demonstrate populated structured
longitudinal clinical resources.

The public [stored FHIR Bundle](https://hackathon2026.vadimperetok.in/fhir/Bundle/1)
and [receiving clinical rendering](https://hackathon2026.vadimperetok.in/#clinical/submission/1)
were opened after submission. Chromium inspection and a captured full-page image
confirmed the fictional identifier, all five explicit “Unavailable” sections, and
the exact signed Patient story. The receiver displays “Unnamed patient,” consistent
with deliberately unavailable name data. No unimported source EPS content appeared.

The immutable private journal retains the actor, exact signed/configuration/mapping
lineage, destination, payload, publication intent, and sanitized result evidence
under report retention. The public document and receiver rendering are external
evidence and may change independently of this repository.
