# Generate synthetic records from the CLI

Run from the repository root after ordinary installation setup. The command loads
`.env.local`, builds the API, and talks directly to PostgreSQL; running API and web
servers are unnecessary. It uses `DATABASE_URL` and the API's patient-key settings.

The CLI uses operator database access and requires no user passwords. By default,
each record is assigned randomly to an active agency user with `clinical:document`
and `clinical:demo` and an available assigned operational unit. Users are sampled
uniformly, regardless of how many units they have. The selected user is recorded
as the documenting clinician, synthetic generator, signer, and audit actor.
Permissions are checked again for each service call. The command does not create
accounts, grant roles, activate definitions, or migrate the database.

```sh
npm run generate:synthetic -- \
  --agency 32000000-0000-4000-8000-000000000001 \
  --count 100 \
  --from 2026-09-01 \
  --to 2026-09-30 \
  --seed september-demo
```

Use the actual agency ID for another installation. Add `--username demo` (or
another agency username) to assign every record to one clinician. Users in other
agencies, inactive users, and users without the required permissions are excluded.
Random assignment also skips units with an existing unopened synthetic call for
that user; if no eligible user/unit remains, the command stops with an explanation.

| Option | Meaning |
| --- | --- |
| `--agency UUID` | Required organization ID. |
| `--username USER` | Optional fixed clinician username; omit for random agency-user assignment. No password required. |
| `--count N` | Required number of records, from 1 to 10,000. |
| `--from YYYY-MM-DD` | First service date, inclusive, UTC; 1950 or later. |
| `--to YYYY-MM-DD` | Last service date, inclusive, UTC; must precede today. |
| `--unit UUID` | Restrict to this assigned unit; otherwise randomly select one of the chosen user's eligible units. |
| `--status signed\|draft` | Defaults to `signed`. Drafts also undergo signing validation. |
| `--seed TEXT` | Repeatable random clinical values and service times for the same configuration. IDs and audit timestamps remain unique. |
| `--dry-run` | Generate, save and validate, then roll back each record. |
| `--help` | Print usage. |

To preview the example, append `--dry-run`. After building once, invoke
`node --env-file-if-exists=.env.local scripts/generate-synthetic-records.mjs`
with the same options to avoid rebuilding for each batch.

## Values and distributions

Dates are sampled uniformly across the requested range. UTC hours use a broad
daytime/evening peak with fewer overnight calls. Response, scene, transport and
handover intervals use bounded log-normal distributions, so most calls have
ordinary durations and some have longer durations. Typical medians are two
minutes to mobilisation, nine minutes travelling to scene, twenty minutes on
scene after reaching the patient, and fourteen minutes transporting. Late calls
are compressed to finish within the selected UTC date. These are illustrative
test-data distributions, not estimates of an agency's actual workload.

Coded fields randomly select from the installed catalog and active form's enabled
choices. Active rules can constrain a choice. Numerical observations vary around
typical values and stay inside catalog bounds. GCS components and total, and
systolic and diastolic pressure, are correlated. Text is explicitly fictional.
External code fields without installed choices use permitted absence values;
optional fields without a valid available choice are omitted.

The generator reads standard fields, custom fields/groups, choice policies,
visibility rules, and the published validation bundle. It repairs common required,
conditional, equality, comparison, cardinality and time-order predicates, then
evaluates the result with the production live/sign validation engine. It checks
persisted values again and executes the normal signing service. Errors and
warnings must be resolved; the CLI does not auto-acknowledge warnings. Review-only
rules can still create review findings after signing.

Arbitrary rules can be contradictory or require values the generator cannot
synthesize, such as an unfamiliar text pattern or a complex metric condition.
Generation stops with the field or failed rule IDs instead of retaining an invalid
record. No validation rules are disabled or replaced. If an active configuration
changes during a batch, generation stops so a batch cannot silently mix versions.

## Persistence and output

Records use the normal synthetic call, draft, audit, signature, and projection
paths. Signed reports are available to review and analytics after the normal
workers process them; select the synthetic dataset. Historical service times
drive reporting dates, while creation, signing, and audit timestamps reflect the
actual run. The agency's synthetic retention policy starts at creation time.

Each record is its own transaction. On failure, the current record rolls back;
previous successful records remain. Output is JSON Lines: a `start` event with
configuration IDs and seed, one `record` event per success, and a `complete`
summary. Each record includes `userId` and `unitId`. Errors go to stderr and exit
nonzero with the completed count. Repeating
a command creates additional records; a seed does not make writes idempotent.

Existing unopened synthetic calls are never consumed. Open the existing call or
choose a different eligible unit before running the CLI.

Dry runs roll back records, assignments, patients, signatures, and their audit
changes. PCR number sequences may advance. Draft output runs signing inside a
savepoint and rolls it back, retaining
the validated draft without a signature.

## Verification

The clinical demo **Populate** action uses the same shared generator as this CLI,
with the open report's pinned form, catalog, custom fields, and validation bundle.
It preserves existing dispatch and clinician-entered values, fills the remaining
fields, and saves through the ordinary demo draft queue. Generation errors leave
the draft unchanged. The detached form preview still uses its fixed demonstration
fixture.

```sh
node tests/synthetic-record-generator.test.mjs
node --env-file-if-exists=.env.local apps/api/tests/synthetic-record-cli-postgres.integration.test.mjs
```

The integration test requires the normal local demo setup. It uses one PostgreSQL
connection and rolls back all test changes, including temporary users, roles, and
its operational unit. It checks random assignment, excluded users, attribution,
and permission revocation in addition to validation and retention.
