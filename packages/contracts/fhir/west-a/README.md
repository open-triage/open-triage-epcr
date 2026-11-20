# WEST-A FHIR R4 exchange

[Open the generated Bundle](bundle.example.json) for a fictional OpenTriage encounter. It contains the patient, encounter, practitioner, seven vital observations, the derived NEWS2 observation, and the triage observation. Its NEWS2 total is 5. The triage observation records chest pain (complaint code `4`), ongoing chest pain with suspected acute coronary syndrome or another serious cause (criterion `15`), and orange priority (`2`). Follow `derivedFrom` from the triage result to the score and its measurements. [Measurement input](assessment.example.json) · [Fictional patient](../../examples/hospital/arne-patient.json)

## Terminology mapping

The `fhir` section of the [WEST-A definition](../../../../defines/decision_support/west-a-2025.json) maps OpenTriage `west-a-2025` definition `1.0.0-draft.6` to public package `west-a.triage#0.1.0`, built 2026-11-20 at 09:48:26 UTC. The package SHA-256 is `27786ceb491e6cd537c063c332631873302cfcba280d0d14272dce7cceb23362`. The continuous build can change under the same version. [Public package](https://build.fhir.org/ig/vadi2/west-a-triage-ig/package.tgz) · [Triage profile](https://build.fhir.org/ig/vadi2/west-a-triage-ig/en/StructureDefinition-west-a-triage-observation.html)

| OpenTriage data | Exchange representation |
| --- | --- |
| 171 selectable adult findings | 162 distinct IG criterion codes. Some categories share the same finding. The mapping check verifies the allowed complaint and priority for every local code. Care needs are criteria, including frailty, likely admission, and interpersonal violence. |
| Primary category | One of 31 IG chief complaints. The caller supplies the assessed primary complaint explicitly. Gynecology subcategories share complaint `11`. Other assessed categories are named in the triage note. |
| Explicit negatives | Code `163` expresses the absence of warning symptoms for the primary complaint. An entry-wide explicit negative or a negative for the whole primary complaint supports this code. Negatives confined to another category or a gynecology subcategory retain their narrower scope in the note. An empty findings list supplies no negative code. |
| Raw measurements and NEWS2 | Observations use LOINC, UCUM and Swedish-edition SNOMED CT. Complete Standard and COPD assessments carry the total and seven component scores. COPD uses the Scale 2 saturation component. Room air maps to zero oxygen flow. Supplemental oxygen with unknown flow contributes to scoring while the unknown flow is documented in a note. |
| Obstetric or incomplete score | Available measurements and the supported priority travel in the Bundle. An obstetric total is labelled ONEWS2 in the triage note. A partial NEWS2 has no numeric total. The IG has no ONEWS2 score profile. |
| Manual or provisional priority | The triage value carries the effective colour. The note carries provisional status or the manual decision, calculated colour, author, selection time, colour at selection and inheritance source when available. The IG has no structured override fields. |
| Patient identity | National personnummer and samordningsnummer OIDs map to the corresponding Swedish identifier URLs. Other identifier systems retain their original namespaces. |

This projection supports one assessment at a time. The source ePCR remains the record of the exact per-category selections and clinical decision history. The example uses an observation Bundle. The package's QuestionnaireResponse is a separate form-capture representation.

## Regenerate and validate

From the repository root, run the following with workspace dependencies installed. The generator writes the Bundle to standard output.

```sh
npm run build -w @open-triage/contracts
node scripts/generate-west-fhir.mjs > /tmp/west-a-bundle.json
cmp /tmp/west-a-bundle.json packages/contracts/fhir/west-a/bundle.example.json
curl -fL https://build.fhir.org/ig/vadi2/west-a-triage-ig/package.tgz -o /tmp/west-a-ig.tgz
python3 scripts/validate-west-fhir-crosswalk.py /tmp/west-a-ig.tgz
java -jar validator_cli.jar /tmp/west-a-bundle.json -version 4.0.1 \
  -ig /tmp/west-a-ig.tgz -tx https://tx.fhir.org/r4 -output /tmp/west-a-outcome.json
```

The [saved OperationOutcome](validation-outcome.json) is from HL7 Validator CLI 7.0.6 with online terminology checks. It reports zero errors, zero warnings and ten informational messages about applicable core vital-sign profiles. The validated Bundle SHA-256 is `13ab68be851a5d4c743e1f89359e8bcc67c7746a9afd36f30b698c72c2cef6f1`. Five additional synthetic cases covered COPD with unknown oxygen flow, obstetric scoring, incomplete vitals, an explicit negative and a manual override. The validator rejected a separate control containing the non-selectable grouping code `AAA` in the criterion slice. [HL7 validator](https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar)

For a finalized ePCR measurement, pass an envelope and its matching FHIR Patient. The envelope contains the canonical `document`, its pinned decision-support `configuration`, the selected `measurementId`, and a `context` object with `resourceBase`, `patientId`, `encounterStatus`, `encounterClass` and `primaryCategory`. Include the actual `performer` and `oxygenFlowLPerMinute` when known. The generator reads the selected vital group and its nested measurements, then checks the stored calculation against the source data. The command also accepts the simpler measurement input format used by the example.

```sh
node --import tsx scripts/generate-west-fhir.mjs encounter-envelope.json patient.json > bundle.json
```

## Validate an open demo record

Open a generated synthetic draft, save the measurement, wait for **Saved**, then choose **Validate FHIR** in the clinical demo bar. The dialog reports the saved revision, number of exported WEST assessments, errors and warnings. Download the Bundle to inspect the resource references or the OperationOutcome for individual findings.

The API reads the authorized saved snapshot. The collection includes the encounter, patient and a DocumentReference containing the canonical encounter JSON and note records. The validator checks the FHIR resources and attachment representation. The JSON inside the attachment retains its native ePCR format. Each finalized WEST measurement contributes its own triage observation and available vitals and NEWS2. A single assessed complaint supplies the primary category. Missing or ambiguous primary complaints produce a finding. A record with no finalized WEST assessment receives a warning.

The local demo requires the workspace dependencies, the built contracts package, Java 21, the HL7 validator JAR and the pinned WEST package. Place the JAR at `.local/fhir-validator/validator_cli.jar` and the package at `.local/fhir-validator/package.tgz`, or set `FHIR_VALIDATOR_JAR` and `WEST_FHIR_PACKAGE` on the API. At startup the API starts one background JVM, checks the package digest, loads R4 and WEST-A, and validates the example bundle to warm the profiles and terminology cache. Subsequent reports share this engine through a private process pipe. Startup is asynchronous. The API retries a failed worker on demand or at its next one-minute health check. Allow up to 2 GiB of Java heap while the demo is running. Use `FHIR_VALIDATOR_JAVA` for an alternate Java executable and `FHIR_VALIDATOR_HOME` for a Java home directory containing a populated `.fhir/packages` cache. The validator can fetch missing package dependencies during setup. The synthetic demo uses HL7’s R4 terminology server at `https://tx.fhir.org/r4` for unit and code checks. Set `FHIR_VALIDATOR_TX_SERVER` on the API to use a different R4 terminology server or `n/a` for offline validation, then restart the API.

Every FHIR Observation exported from a synthetic demo draft references the fictional practitioner `synthetic-registrar` as its performer. This includes generated, manually entered and imported measurements, the NEWS2 score and the WEST triage result.
