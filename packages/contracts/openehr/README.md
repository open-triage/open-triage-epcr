# WEST-A openEHR template

[Download the English-language operational template](./west-a-2025.opt) for finalized adult triage assessments in one encounter. Its template ID is `OpenTriage WEST-A 1.0.0-draft.4`. The clinical content comes from the repository's pinned WEST-A definition, which uses Östra/SU 2025:02:01 for findings and SkaS/VGR 2025:1 for physiology. The definition records local decisions, including allowing a clinician to lower urgency while retaining the calculated result. The profile is a draft for interoperability review. [WEST rules](../../../defines/decision_support/west-a-2025.json) · [Östra adult guide](https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/su1226-506079272-668/surrogate/WEST%20A%202025%20%C3%96stra.pdf) · [SkaS guide](https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/skas13221-468498705-9/surrogate/WEST%20samt%20h%C3%A4nvisningsst%C3%B6d%20SkaS.pdf)

## Standards and import

The openEHR Archetype Model release 2.3.0 lists OPT 1.4 as stable and OPT 2 as in development. This file uses OPT 1.4 XML in the `http://schemas.openehr.org/v1` namespace. Import it through a CDR's ADL 1.4 template import, or send the XML body with content type `application/xml` to `POST /definition/template/adl1.4` under its openEHR API base URL. [Archetype Model release](https://specifications.openehr.org/releases/AM/Release-2.3.0) · [Definition API 1.1.0](https://specifications.openehr.org/releases/ITS-REST/Release-1.1.0/definition.html)

The template constrains the published Encounter composition, `openEHR-EHR-COMPOSITION.encounter.v1`, to one local observation, `openEHR-EHR-OBSERVATION.opentriage_west_a.v0`. Its history contains one or more point events. This keeps the scale, findings, measurements and clinical judgment together even when consecutive measurements use different scales. The CKM NEWS2 observation describes standard NEWS2 and specifically excludes the obstetric population. [CKM Encounter](https://ckm.openehr.org/ckm/archetypes/openEHR-EHR-COMPOSITION.encounter.v1) · [CKM NEWS2](https://ckm.openehr.org/ckm/archetypes/1013.1.3342) · [Reference Model 1.1.0](https://specifications.openehr.org/releases/RM/Release-1.1.0/data_structures.html)

## Recording an assessment

| Source | openEHR location within the observation |
| --- | --- |
| Pinned system key and definition version | `protocol[at0004]` contains two required fixed values. |
| Vital group occurrence ID and measurement instant | `data[at0001]/events[at0002]` carries the group UUID in `uid.value` and the measurement time with its original UTC offset in `time.value`. Use the earliest measurement as the history origin. |
| Categories, criteria and explicit negatives | Event data elements `at0010` and `at0011` repeat. Category-specific negatives retain the source code `<category>.none`. The separate boolean `at0012` records the entry-wide assessment. |
| Scale and observations | `at0013` records the selected scale, including the initial `standard` default. The six measured quantities carry units, ranges and precision. Oxygen support and ACVPU carry explicit codes. Blood pressure uses UCUM `mm[Hg]` and temperature uses `Cel`. Pulse is available separately when it supplies the heart-rate component. |
| Physiology and calculated urgency | `at0030` holds the known component points. `at0031` holds the complete NEWS2 or obstetric ONEWS2 total, including zero. Omit the total when inputs are incomplete. `at0032` through `at0035` record the physiology color, driving criterion, calculated WEST color and calculation status. The application's saved code for the definition's “established” status is `definitive`. |
| Override and effective urgency | Optional cluster `at0050` requires the manual color, author ID and time. It can also carry the color at selection and the previous measurement ID for an inherited override. Every finalized event requires one effective color in `at0036`. |

The template embeds the selectable codes and English display terms. Use the pinned decision-support rules to score inputs, check findings against categories and local time, and set the effective color from the override or calculation. Those cross-field checks belong to the producer. An unsupported calculation may be saved with a manual color. Omit unsaved drafts and legacy measurements without a WEST assessment. [Application scoring and finalization rules](../../../docs/prds/west-triage-decision-support.md)

## Reproduce and verify

Run from the repository root after installing the workspace dependencies.

```sh
npm run build -w @open-triage/contracts
node scripts/generate-west-openehr.mjs --check
```

Omitting `--check` regenerates the OPT. For independent schema validation, point an XML Schema validator at the stable v1 `Template.xsd`, keeping its sibling XSD files together. This revision was also parsed by EHRbase SDK 2.9.1. Its composition validator accepted a synthetic repeat assessment with an inherited override and rejected the same record with its effective color removed. [Official XML schema](https://github.com/openEHR/specifications-ITS-XML/blob/Release-1.0.2/components/ALL/Template.xsd) · [EHRbase SDK](https://github.com/ehrbase/openEHR_SDK/tree/v2.9.1)
