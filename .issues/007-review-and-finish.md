## What to build

Complete the synthetic encounter journey with a Review and finish flow that consolidates event and checklist validation, links directly to every problem, requires acknowledgement of warnings, blocks completion on errors, and produces a read-only usability-prototype summary without implying a legal signature.

## Acceptance criteria

- [ ] The remaining-required indicator opens the consolidated validation and review experience.
- [ ] Errors from vital, medication, procedure, note/checklist, disposition, and narrative state appear in one actionable summary.
- [ ] Selecting a finding returns the clinician directly to the affected entry or field.
- [ ] Blocking errors prevent completion and warnings require explicit acknowledgement.
- [ ] Finishing produces a read-only summary containing the curated patient context, timeline, checklist values, and warning acknowledgements.
- [ ] The summary is labeled as a synthetic usability prototype rather than a signed or complete legal clinical record.
- [ ] Continue editing returns to the canonical encounter state without losing data.
- [ ] Relevant end-to-end and validation tests demonstrate valid, invalid, missing, boundary, and warning cases.

## Blocked by

- Blocked by `003-capture-vital-signs.md`
- Blocked by `004-document-medication.md`
- Blocked by `005-document-procedure.md`
- Blocked by `006-complete-clinical-checklist.md`
