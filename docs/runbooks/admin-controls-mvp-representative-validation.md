# Admin Controls MVP representative validation

Issue: [#265](https://github.com/open-triage/open-triage-epcr/issues/265)

Parent PRD issue: [#252](https://github.com/open-triage/open-triage-epcr/issues/252)

Protocol version: 1

This is the human acceptance protocol for the Admin Controls MVP. Automated
tests establish the technical safety boundaries, but they cannot establish that
a representative agency administrator completed the journey unaided in less
than 30 minutes. Do not mark issue #265 accepted until the signed result record
at the end of this document has been completed by an observer and both
participants.

## Roles and independence

- **Representative administrator:** an agency administrator who did not build
  the feature and has not rehearsed this exact workflow. They may read the task
  card below, but must use only visible product copy and controls after the
  timer starts.
- **Clinician:** a clinician who did not configure the form. They complete and
  sign the newly created report after the owner journey.
- **Observer:** prepares the installation, records times and outcomes, and stops
  the run on an automatic failure. During the timed owner journey the observer
  must not explain the interface, point to a control, use the keyboard or
  pointer, modify the database, call an API, or provide developer assistance.

Questions asked aloud by the owner are recorded verbatim. The observer replies
only, “Please continue using the information in the product.” A request for or
receipt of procedural help makes the unaided criterion fail.

## Prepare the installation

Preparation is operator work and happens before the timed session.

1. Check out the exact candidate commit and record its full SHA below.
2. Use a fresh fictional installation. Never use patient or production data.
3. Start the API and web processes as described in the repository `AGENTS.md`.
4. Provision one owner and one clinician with the account CLI. Complete each
   forced password change before the observed run.
5. Assign the clinician to the test unit and confirm that unit has an active
   Stationary form.
6. Create and save an **old report** before the owner activates anything. Record
   its report ID, catalog release ID, form version ID, visible section order,
   visible field order, configured requiredness, and the relevant code-list
   choices. Save browser screenshots of those visible states.
7. Create a second unused fictional assignment for the clinician. This will
   become the new report after activation.
8. Confirm the browser is online, at 100% zoom, and uses the supported desktop
   viewport. Remove assistive observer overlays and browser extensions that
   reveal target controls. The participant may use their normal assistive
   technology.
9. Give the owner only the task card below. Do not give them this protocol,
   selectors, API endpoints, database identifiers, or a sequence of controls.

### Owner task card

> Configure the agency’s Stationary form for future reports. In the element
> catalog, change one code list and change one field’s agency-required setting,
> then publish the catalog with a meaningful note. Create a Stationary form
> based on that catalog. Add one element, remove one element, change the order
> of elements, remove one section, and change the order of sections. Preview
> the result, publish it with a meaningful note, and explicitly activate it as
> the agency default. Use the keyboard only; do not use a mouse, trackpad, or
> touchscreen. Tell the observer when you believe the new default is active.

## Observe the owner journey

Start the 30-minute timer when the owner first receives control of the signed-in
application and task card. Record one row for every required outcome. Exact
control names are intentionally absent: discovery is part of the evaluation.

| Required outcome | Time observed | Pass/fail | Objective evidence or note |
| --- | --- | --- | --- |
| Enters Admin mode without a pointer | | | |
| Clones the active catalog | | | |
| Changes one code list | | | |
| Changes one agency-required setting | | | |
| Saves, validates, and publishes the catalog with a meaningful note | | | |
| Clones the active Stationary form against the published catalog | | | |
| Adds one element and does not create a duplicate | | | |
| Removes one element | | | |
| Reorders elements | | | |
| Removes one section after understanding the affected fields | | | |
| Reorders sections | | | |
| Uses the interactive preview and returns to the unchanged draft | | | |
| Saves and publishes the form with a meaningful note | | | |
| Separately activates the form as the agency default | | | |

Stop the timer when the owner says the new default is active. The owner phase
passes only when every row passes, no procedural assistance was given, no
pointer was used, and elapsed time is strictly less than 30:00.

## Observe the clinician and historical report

This phase is not part of the owner's 30-minute timer, but it is required for
MVP acceptance.

1. Sign the owner out. Let the clinician sign in without owner credentials.
2. Open the unused assignment, creating a new report.
3. Record its catalog release and form version IDs. They must equal the versions
   activated by the owner.
4. Confirm the changed code list, requiredness, included elements, element
   order, included sections, and section order are visible in Stationary mode.
5. Have the clinician complete the configured fields, resolve all blocking
   validation, review the report, and sign it. Record the signed report ID and
   screenshot the signed outcome.
6. Reopen the old report through the normal product workflow. Compare every
   recorded item from preparation. Its catalog release ID, form version ID,
   document, rendering, validation, section/field order, requiredness, and code
   choices must be unchanged.
7. Attempt no direct database repair or API workaround. A report that can be
   completed only with such intervention fails acceptance.

## Automatic failure conditions

Stop and mark the entire run failed if any of these occurs, even when the owner
finishes within 30 minutes:

- any owner authorization bypass or successful privileged action by the
  clinician;
- mutation of a published catalog, published form, signed report, or the old
  report's pinned configuration;
- clinical-data corruption or loss;
- duplicate placement of a form element;
- inability to complete and sign the configured new report;
- pointer use, observer/developer/database assistance, or elapsed owner time of
  30:00 or more;
- a serious or critical accessibility defect that blocks the keyboard journey.

## Automated evidence required for the candidate commit

Run these commands against the same commit and installation used for the human
session. Attach complete logs to the issue or PR. A skipped database suite is
not a pass: configure `DATABASE_URL` and rerun it.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:a11y -w @open-triage/web -- admin-shell.spec.ts accessibility-journey.spec.ts stationary-completion-journey.spec.ts
```

The evidence must identify passing coverage for:

- durable owner/clinician sessions, CSRF, capabilities, and denied privileged
  requests;
- catalog and form draft concurrency, validation, publication immutability,
  form/catalog pinning, and activation audit events;
- active configuration used by a new report and an older report retaining its
  exact configuration after activation;
- Stationary completion/signing and the keyboard/accessibility journeys.

## Result record

Copy this section into the issue or attach the completed document. Preserve the
blank template in the repository for repeatable evaluations.

```text
Status: NOT RUN (PASS or FAIL only after the observed session)
Candidate commit:
Installation/environment identifier:
Browser and version:
Viewport:
Assistive technology, if any:

Representative administrator name or study ID:
Administrator relationship to agency:
Administrator confirms no prior rehearsal of this exact workflow: YES / NO
Clinician name or study ID:
Observer name or study ID:
Session date and timezone:

Owner start time:
Owner stop time:
Owner elapsed time (mm:ss):
Owner used keyboard only: YES / NO
Procedural help requested or given (quote and timestamp, or NONE):
All owner outcome rows passed: YES / NO

Old report ID:
Old catalog release ID:
Old form version ID:
Activated catalog release ID:
Activated form version ID:
New signed report ID:
New report used activated IDs: YES / NO
New configured report signed successfully: YES / NO
Old report and behavior unchanged: YES / NO

Authorization bypass observed: YES / NO
Published or historical mutation observed: YES / NO
Clinical-data corruption observed: YES / NO
Duplicate form element observed: YES / NO
Serious/critical accessibility blocker observed: YES / NO
Any other automatic failure condition: YES / NO (explain)

Automated command log links:
Screenshot/video/evidence links:
Observer notes:

Overall result: NOT RUN / PASS / FAIL
Administrator attestation and date:
Clinician attestation and date:
Observer attestation and date:
```

A `PASS` is valid only if the owner completed every outcome unaided and
keyboard-only in under 30 minutes, the clinician signed the newly configured
report, the old report remained unchanged, all automated evidence passed, and
every automatic-failure answer is `NO`.
