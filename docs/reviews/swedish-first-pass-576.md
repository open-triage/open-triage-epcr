# Swedish first-pass review record (#576)

Status: **awaiting a Swedish-speaking reviewer**. This record separates machine checks from the clinical and language decisions required by the issue. The reviewer should use a disposable demonstration organization and fictional patient data.

## Machine coverage snapshot

Run from the repository root:

```sh
npm run audit:localization -w @open-triage/database
npm run audit:form-localization -w @open-triage/database
```

Snapshot from `feature/localization` at `027a41f` on 2026-09-28:

| Inventory | Supplied / expected | Missing | Needs human review |
| --- | ---: | ---: | ---: |
| Catalog elements | 453 / 453 | 0 | 394 |
| Catalog groups | 88 / 88 | 0 | 88 |
| Catalog lists | 215 / 215 | 0 | 99 |
| Catalog choices | 3,656 / 3,656 | 0 | 3,319 |
| Catalog special choices | 559 / 559 | 0 | 43 |
| Full NEMSIS form sections, fields, rules | 27, 14, 706 | Audit accepted | 666 rules |
| Sweden form sections, fields, rules | 15, 15, 426 | Audit accepted | 393 rules |

The catalog count is 3,943 distinct `reviewPending` entries. The form and validation seeds add 1,059 pending rule entries. These flags identify review work; they are not a translation defect count or a human approval. The audit output supplies each stable identity and reason. Review the English source alongside the Swedish text, especially US-specific concepts and rule assertions retained in English. See [`defines/localization/sv/README.md`](../../defines/localization/sv/README.md) for seed behavior and authoring routes.

## Representative journey checklist

Record device or viewport, profile (`sweden` or `nemsis-full`), catalog/form/validation release versions, and date in the findings below. Set the agency language to Swedish in **Administration → Organisationsinställningar**, save, and reload the workspace. Repeat a representative path in English to compare clinical meaning. For the local database-backed app, follow the root `AGENTS.md` start and synthetic bootstrap instructions.

| Journey | Reviewer action and questions | Human result |
| --- | --- | --- |
| Mobile | Open an assigned call, enter and reopen vitals, use coded choices and units, add text/photo/audio notes, and inspect the checklist. Are labels and values understandable to a Swedish clinician? | Pending |
| Stationary | Navigate patient, scene, and other sections; add a repeating group; enter a field; review blocking findings and return to the record. Check field, group, unit, and rule wording together. | Pending |
| Authoring | In Catalog, Form, and Validation drafts, inspect **Needs review** and missing-text summaries. Compare source text, translated choices, form headings/help, and validation names/messages across both profiles. Confirm that a wording correction can be saved, validated, and published through the normal draft flow. | Pending |
| Settings and administration | Confirm language changes after reload, administrative actions and API error messages, and any English fallback. Check Swedish dates, times, and numeric input against agency locale and time zone. | Pending |
| Validation and errors | Trigger a required field, an invalid value, a validation rule, and a server failure. Check that severity and clinical meaning survive translation. A missing-text warning should remain advisory. | Pending |
| Offline and historical | Open a localized report, go offline, reopen it, then return online. Inspect historical wording and the currently active language/version after sync. | Pending |

The existing browser checks in `apps/web/e2e/localization.spec.ts`, `mobile-localization.spec.ts`, and `stationary-localization.spec.ts` cover a subset of settings, mobile, and stationary behavior with mocked API responses. They cannot judge clinical terminology or replace the full journey review above. Record the command and result of each automated run below.

Automated results on 2026-09-28 from `027a41f`:

| Check | Result |
| --- | --- |
| Catalog and form localization audit commands above | Passed; coverage and review counts shown above |
| `npm run build && npm run typecheck && npm run lint` | Passed |
| `node --test packages/database/tests/catalog-localization.test.mjs packages/database/tests/form-validation-localization.test.mjs` | 6 passed |
| `node --import tsx --test apps/web/tests/localization.test.ts apps/web/tests/catalog-localization.test.ts apps/web/tests/form-localization.test.ts apps/web/tests/translation-diagnostics.test.ts` | 12 passed |
| `OPEN_TRIAGE_E2E_SERVER_MODE=true npx playwright test --config apps/web/playwright.config.ts apps/web/e2e/localization.spec.ts apps/web/e2e/mobile-localization.spec.ts apps/web/e2e/stationary-localization.spec.ts` | 10 passed across 360 px and 390 px viewports |

## Findings and decisions

Reviewer name and clinical/coding role: **Pending**  
Review date and app commit: **Pending**  
Device, agency/profile, and release versions: **Pending**  
Additional automated commands and results after reviewer corrections: **Pending**

For each finding, copy this row. Use a stable element, group, list, choice tuple, form section/field, rule ID, or UI message key so related occurrences can be checked together. The disposition must be `corrected`, `confirmed`, or `needs review`; record a rationale for confirmations and remaining review. Do not clear a seed `reviewPending` item solely because an automated audit passes.

| ID and journey | English source and current Swedish wording | Clinical meaning or usability concern | Disposition and rationale | Correction location/version or follow-up issue | Regression evidence |
| --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | needs review — awaiting reviewer | Pending | Pending |

For definition wording, make corrections in a cloned Catalog, Form, or Validation draft through the interface, validate it, then publish the new version. Record the version and recheck affected mobile and stationary use. For application UI wording, correct the Swedish release dictionaries in code and verify the affected browser path. Keep missing-text warnings advisory; do not add a publication or activation completeness gate.

## Review decision

- [ ] Swedish-speaking reviewer completed all six journeys above.
- [ ] Ambiguous and US-specific terms were checked across elements, choices, units, forms, rules, and UI text.
- [ ] Every finding has a correction/confirmation or an explicit remaining `needs review` disposition.
- [ ] Corrections have relevant regression evidence; draft and publication versions are recorded.
- [ ] Reviewer recorded approval or remaining limitations here and in #576.

Decision, reviewer, and date: **Pending human review**.
