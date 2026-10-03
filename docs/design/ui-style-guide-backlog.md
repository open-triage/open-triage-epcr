# UI remediation backlog

Updated: 2026-10-03. Rules are defined in the [UI style guide](ui-style-guide.md).

This backlog records existing departures for future UI work. New or changed UI
must follow the guide, including shared components needed for that work. Record
other findings here rather than expanding a feature into an unrelated redesign.

## Audit scope and method

The 2026-10-03 review covers the current working tree, including uncommitted
changes, across all four route entry points and the UI families implemented by
the 54 TSX components under `apps/web/components`. Source review covered layout,
branding, shared CSS, controls, editor state, navigation, and save feedback.

Browser checks rendered the actual Home/component code and all three app
stylesheets in Chromium through a temporary esbuild harness. Admin/Review API
requests were intercepted with synthetic fixtures; clinical views used the
bundled local-demo fixtures. No live API/database writes were made. These checks
verify component behavior and appearance, not deployment/database integration.

Recorded **31 rendered states** at **1440×900 desktop** and **390×844 mobile**.
Admin/Review also used a blue agency accent (`#315ba8`), purple destructive color
(`#8a2670`), inactive surface (`#edf1fa`), and agency text (`#202850`). Screenshots,
DOM dimensions, and computed styles informed the findings; both browser runs
finished without uncaught page errors. Temporary artifacts are retained in
`/tmp/open-triage-ui-audit`; durable evidence is described below with source links.
Dimensions below are CSS pixels.

**Evidence:** Browser = observed in a rendered fixture; Source = a concrete
implementation departure, with remaining browser checks stated. Neither implies
every permission, failure, data, or device state was exercised. Recheck findings
against the latest tree before implementing them.

**Suggested priority:** P1 = lost edits, overflowing controls, or core keyboard /
navigation behavior; P2 = consistency, density, or task layout. These are triage
recommendations, not scheduled implementation work. All UI-001–UI-026 entries
are **open and deferred**. Existing IDs UI-001–UI-007 are retained; UI-007's
publication-prerequisite finding is consolidated into the expanded height audit.

| UI family | Review coverage | Candidates / remaining verification |
| --- | --- | --- |
| Authentication and session shell | Sign-in rendered at both sizes; source review of loading/failure, password replacement, no-workspace, logout warning, presentation selector, language menu, feedback, transient notices. | UI-002, UI-007–UI-008, UI-016, UI-018. Conditional authentication/logout and feedback pending/error states need browser checks. |
| Calls and open reports | Call list rendered; source review of assigned/open cards, creation/reopening, cancellation, polling, recovery reauthentication. | UI-005–UI-006, UI-015–UI-016. Check large lists and recovery prompts. |
| Clinical record and signing | Stationary rendered at both sizes; mobile timeline rendered; source review of headers, section navigation, sidebar, checklist, finding editors, conflicts, signing, autosave. | UI-002, UI-006–UI-008, UI-014–UI-016, UI-021–UI-022. Check populated signing/conflict/offline states, focus, enlarged text. |
| Documentation editors and controls | Mobile vital, medication, procedure, text, photo, and audio dialogs rendered initially; source review of time, coded/scalar/exceptional controls, repeating/nested groups, custom fields, sorting, media viewers/deletion. | UI-002, UI-005, UI-007–UI-008, UI-014, UI-021–UI-022, UI-026. Selected, nested/custom, hardware capture, and keyboard states need browser checks. |
| Admin dashboard, Users, Roles | Dashboard, 50-user list, user creation, role matrix rendered; source review of identity/role editing, sessions, credential reset, ownership transfer, role editing/deactivation/history. | UI-005, UI-007–UI-009, UI-016–UI-018, UI-025. Conditional management/security/history panes need browser checks. |
| Admin catalog | Element workspace rendered; source review of group, fixed/custom element, code-list, translation, version, save/validate/publish workflows and stored drafts. | UI-002, UI-005, UI-007–UI-008, UI-012, UI-016, UI-018, UI-022. Check conditional editors and large choice/translation sets. |
| Admin form and validation | Form and validation rendered; form also rendered on mobile; source review of sections/choices/sorting, diagnostics, rule library/editor/explanation, versioning, publication, activation, removal. | UI-005, UI-007–UI-008, UI-012–UI-013, UI-016, UI-018, UI-025. Hidden errors and activation/removal flows need browser checks. |
| Agency settings | Six fieldsets rendered at both sizes; unsaved mode-navigation behavior exercised. | UI-001, UI-005, UI-007–UI-008, UI-013, UI-016–UI-018. Check invalid fields, stale revision, logo upload, language changes. |
| Review queue and report | 25-row queue, inspector, full-report transition, mobile queue rendered; return-scroll behavior exercised; source review of filters/attention/bulk, discussion, assignments, completion, history, overdue exceptions, findings, media. | UI-002–UI-004, UI-008, UI-010, UI-016, UI-018, UI-020–UI-022. Check page/filter preservation and mobile detail/focus with populated reports. |
| Review analysis and settings | Volume, clinical analysis, saved analyses, settings rendered; saved analyses also rendered on mobile; policy-refresh behavior exercised; source review of workload, CSV, routing, outcomes, deadlines, clearance, backlog. | UI-002–UI-004, UI-008, UI-011, UI-018–UI-019, UI-024. Check nonempty results, exports, and saved-definition refresh. |
| Utility routes and retained components | Source review of `/admin-preview`, `/review-call`, not-found, and retrospective panel. `ReviewRetrospectivePanel` currently has no caller in the app's TSX entry points. | UI-023–UI-024. Check standalone success/error states and preview branding; retrospective layout if reconnected. |

## Confirmed departures in source

All entries below are open and deferred. Suggested fixes describe future work.

| ID | Rule and finding | Evidence | Intended resolution |
| --- | --- | --- | --- |
| UI-001 | Separate tasks instead of stacking a long page: agency settings renders language, regional format, time zone, media limits, appearance, and demographics as consecutive fieldsets with Save at the end. | [AgencySettingsPanel](../../apps/web/components/agency-settings.tsx), its form beginning at line 121; `.agency-settings form` in [styles.css](../../apps/web/app/styles.css). | Group settings into task tabs within a bounded workspace; keep save status and actions accessible. Preserve edits when switching tabs and make errors in other tabs discoverable. |
| UI-002 | Shared button hierarchy: global buttons default to accent fill, while the inactive appearance override only covers clinical presentation containers. Admin navigation and Review tabs/secondary actions therefore retain filled styling even when unselected. | Global `button` and clinical container rules in [styles.css](../../apps/web/app/styles.css); [ReviewTabs](../../apps/web/components/review-tabs.tsx); `.review-tabs` in [review-workspace.css](../../apps/web/app/review-workspace.css). | Apply explicit shared primary, secondary, selected, destructive, and disabled treatments across all workspaces. Check clinical primary actions as well, since the clinical override currently makes ordinary actions quiet by default. |
| UI-003 | Agency-configured accent: Review focus outlines use literal `#00783a`, so changing the agency accent leaves these controls with the default green focus ring. | `.review-workspace … :focus-visible` in [review-workspace.css](../../apps/web/app/review-workspace.css), line 16. | Use a shared focus treatment that follows the agency palette while remaining visible against adjacent surfaces. |
| UI-004 | Agency-configured text: Review form controls explicitly use `#222e25`, overriding the inherited agency text color. | `.review-workspace :is(input:not([type=checkbox]), select, textarea)` in [review-workspace.css](../../apps/web/app/review-workspace.css), line 18. | Use the shared agency text token for normal form-control text and verify with a nondefault agency palette. |
| UI-005 | Consistent field styling and spacing: the form section creation/name inputs and validation version display-name input have no matching shared field appearance rule. Section creation renders its label, input, and button together without a layout gap on their fieldset. The generic input rule only sets touch behavior; surrounding grid spacing does not supply input padding or field styling. | `#new-section-name` and the section-name input in [form-authoring.tsx](../../apps/web/components/form-authoring.tsx); `#validation-display-name` in [validation-authoring.tsx](../../apps/web/components/validation-authoring.tsx); `.form-fields`, `.form-editor`, and the scoped input rules in [styles.css](../../apps/web/app/styles.css). | Apply a shared field and field-group treatment with consistent padding and external spacing. Verify these examples in the browser, then inspect other authoring fields for the user's reported issue. |
| UI-006 | Semantic colors must remain consistent across agencies: a clear validation timeline marker uses the agency accent, so its status color changes with branding. | `.event-dot.validation-clear { background: var(--green); }` in [styles.css](../../apps/web/app/styles.css). | Use the shared semantic success/clear treatment and verify that status remains understandable without color. |

## Verification of initial findings

The original findings now have the following additional evidence and priorities:

| ID / priority | Additional evidence and verification |
| --- | --- |
| UI-001 / P2 | **Browser:** Settings document height was **2639px** at 1440×900 and **3152px** at 390×844. Save remains after all six fieldsets. Verify task tabs preserve edits and expose hidden errors when remediating. |
| UI-002 / P2 | **Browser:** Unselected Admin panels, Review tabs, and session presentation buttons remain accent-filled under the blue palette. Clinical Add vital set and Cancel have the same outline treatment. Apply the hierarchy to shared session controls and dialog actions too. |
| UI-003 / P2 | **Source:** Review focus remains literal default green; keyboard-check visibility with the nondefault palette when fixing. |
| UI-004 / P2 | **Browser:** Review controls computed as `rgb(34, 46, 37)` with agency text set to `#202850`. Verify editable/disabled control text after remediation. |
| UI-005 / P1 | **Browser:** Form `#new-section-name`, section-name input, and `#form-display-name` measured **21px**, with `1px 2px` padding. `#form-section-navigation` and move-to-section selects measured **19px**, with no padding. `#validation-display-name` measured **21px**. Settings `#agency-language` / `#agency-regional-format` and validation's translation filter measured **19px**. See [form authoring](../../apps/web/components/form-authoring.tsx), [form publication input](../../apps/web/components/stationary-form-authoring.tsx), [agency settings](../../apps/web/components/agency-settings.tsx), [translation summary](../../apps/web/components/translation-issue-summary.tsx). **Source-only extensions:** recovery-password, ownership-transfer, custom-text, and repeated-custom fields lack complete matching shared field treatments in [styles.css](../../apps/web/app/styles.css); see [open reports](../../apps/web/components/open-reports.tsx), [ownership transfer](../../apps/web/components/ownership-transfer.tsx), [custom text](../../apps/web/components/custom-text-fields.tsx), [repeated custom fields](../../apps/web/components/repeated-custom-fields.tsx). Browser-check these conditional controls, including spacing, focus, and disabled states. |
| UI-006 / P2 | **Source:** Also inspect `.open-report-card.validation-clear … strong` and `.review-empty`, which use agency accent tokens for clear/success status. Timeline markers already have meaningful labels in [encounter-timeline.tsx](../../apps/web/components/encounter-timeline.tsx); retain them when introducing semantic tokens. |

## Additional confirmed remediation candidates

### Shared controls, branding, and density

| ID / priority | Rule and finding | Evidence | Intended resolution and verification |
| --- | --- | --- | --- |
| UI-007 / P1 | **44px minimum:** many controls override the shared minimum height. | **Browser + Source.** Session controls **40px**, presentation buttons **34px**; Users filters **42px**, creation actions **40px**; role-matrix actions **34px**; version selects **38px**; Stationary header actions **34px**, section buttons **38px**, row edit/remove **30px**, scalar occurrence actions **36px**; timeline filters **36px**. [styles.css](../../apps/web/app/styles.css): `.session-bar`, `.presentation-selector`, `.admin-*`, `.authoring-version-row`, `.stationary-*`, `.timeline-filters`. Authoring inputs/selects and validation-library filters declare **38px** minimums, previously recorded during publication prerequisite work outside the changed publication action. **Source-only:** demo controls **28px**, time-wheel buttons **38px**, exceptional-menu choices **42px**. | Remove undersized overrides and share 44px variants. Measure every listed context, including scalar sort-handle specificity. Small checkbox/radio marks may remain inside usable labeled targets. |
| UI-008 / P2 | **Consistent typography:** controls inherit caption/browser sizes and headings drift above the shared scale. | **Browser + Source.** Users search/creation controls inherit **12px** label typography; unstyled fields use **13.33px**; Review entry controls use **14px** rather than the control role. Admin h1 **32px**, Review h1 **30px**, desktop sign-in up to **56px**, versus the heading starting size **24px**. [styles.css](../../apps/web/app/styles.css), [review-workspace.css](../../apps/web/app/review-workspace.css). | Apply shared type roles deliberately; review oversized headings for compact workspaces. Verify readability, enlarged text, and mobile wrapping without shrinking text to regain fit. |
| UI-016 / P2 | **Agency text/accent beyond Review:** fields and structural accents bypass agency tokens. | **Browser + Source.** Settings text controls compute as black instead of `#202850`; Users filters use muted gray. Admin rules use undefined `--ink` or omit control text color. Catalog editor borders use `#4d7457`; encounter-summary values use `#30332f`. [styles.css](../../apps/web/app/styles.css): `.agency-settings`, `.admin-directory-filters`, `.admin-user-create`, `.catalog-element-editor`, `.code-list-editor`, `.encounter-summary`. | Route normal text and structural accent through agency tokens, retaining intentional muted/semantic colors. Verify fields, values, and conditional editors with a clearly different palette. |
| UI-017 / P2 | **Destructive hierarchy:** some destructive Admin actions use ordinary accent buttons. | **Browser + Source.** Role Deactivate remains blue with a purple destructive palette. Revoke session, Confirm deactivation, Reset credential and revoke sessions, and Remove logo have no destructive class. [admin-directory.tsx](../../apps/web/components/admin-directory.tsx), [agency-settings.tsx](../../apps/web/components/agency-settings.tsx); danger selectors in [styles.css](../../apps/web/app/styles.css). | Mark destructive commit actions with the shared variant; keep Edit/History/Cancel secondary. Verify conditional session, credential, retirement, and logo workflows. |

### Workspace layout and mobile adaptation

| ID / priority | Rule and finding | Evidence | Intended resolution and verification |
| --- | --- | --- | --- |
| UI-009 / P2 | **Bound large directories and actions:** Users list grows down the document; Load more appends rows. | **Browser + Source.** 50 users produce a **4006px** document; creation increases it to **4510px**. `.admin-table-scroll` has horizontal overflow only; Load more follows the table. [admin-directory.tsx](../../apps/web/components/admin-directory.tsx), [styles.css](../../apps/web/app/styles.css). | Bound desktop rows with accessible pagination/load controls and sticky headings. Use an inspector/dedicated view for substantial management. Verify 0/50/100+ users and conditional session/history lists. |
| UI-010 / P2 | **Reachable pagination in a bounded workspace:** Review pagination does not prevent a tall queue. | **Browser + Source.** 25 rows produce a **3877px** desktop document; opening the inspector does not shorten it. `.review-table-scroll` sets horizontal overflow only. [review-shell.tsx](../../apps/web/components/review-shell.tsx), [review-workspace.css](../../apps/web/app/review-workspace.css). | Size the collection against remaining viewport space after headers/filters. Scroll rows inside it and retain reachable pagination. Verify expanded filters/bulk controls and inspector transitions; retain usable mobile table scrolling. |
| UI-011 / P2 | **Separate Review settings tasks:** routing, outcomes, deadline, clearance policy, and processing backlog stack in one card. | **Browser + Source.** One route already produces a **1699px** desktop document. `.review-settings-layout` is overridden to `display: block`; consecutive children receive 24px margin/padding. [review-shell.tsx](../../apps/web/components/review-shell.tsx), [review-workspace.css](../../apps/web/app/review-workspace.css). | Use task tabs, bounded routing/backlog collections, and accessible save/status for the current editor. Verify realistic counts, drafts, and hidden errors. |
| UI-012 / P2 | **Focused authoring and accessible Save:** versioning, diagnostics, collections, editors, and publication stack. | **Browser + Source.** Minimal catalog **1497px**, form **1471px**, validation **1129px** at 1440×900. Catalog and validation Save actions sit near the end; form has a sticky toolbar but publication follows all sections. [catalog-authoring.tsx](../../apps/web/components/catalog-authoring.tsx), [stationary-form-authoring.tsx](../../apps/web/components/stationary-form-authoring.tsx), [validation-authoring.tsx](../../apps/web/components/validation-authoring.tsx), [translation summary](../../apps/web/components/translation-issue-summary.tsx). Table max-heights do not bound the full workspace. | Separate editing/publication/version tasks; use an inspector or dedicated view for complex element/rule edits. Share a save/status toolbar; bound diagnostics and lists. Verify large choice/rule/translation sets and draft preservation. |
| UI-013 / P1 | **Mobile width adaptation:** settings and form authoring exceed the viewport. | **Browser + Source.** At 390px, settings document width **434px**, form **533px**. Form picker uses `minmax(180px, .7fr) minmax(280px, 2fr)` without a narrow single-column override; section rows/fieldsets/native inputs need containment too. Settings lacks consistent native-field width bounds. [styles.css](../../apps/web/app/styles.css), [form-authoring.tsx](../../apps/web/components/form-authoring.tsx), [agency-settings.tsx](../../apps/web/components/agency-settings.tsx). | Adapt field groups/action rows and bound controls/fieldsets. Verify 320/360/390px and enlarged text without page-wide overflow, retaining horizontal scrolling for genuinely wide tables. |
| UI-014 / P1 | **Wide clinical tables scroll within panels:** repeating-group panels expand the mobile page. | **Browser + Source.** At 390px, document width **715px**; Crew group reaches x=715, Add Crew x=682, row edit/remove x=655/692. Insurance and Supply Item groups also expand. Tables use `min-width: 42rem` without sufficient ancestor containment. [styles.css](../../apps/web/app/styles.css), [stationary-repeating-groups.tsx](../../apps/web/components/stationary-repeating-groups.tsx). | Constrain group/scroll-wrapper widths so only tables scroll horizontally; keep headings/Add reachable. Verify nested groups and long values. Desktop also measured 1484px scroll width at 1440px; investigate its cause separately. |
| UI-015 / P2 | **Current task within desktop workspace:** Stationary renders every section down one page; mobile section navigation consumes much of the screen. | **Browser + Source.** Bundled record height **19313px** desktop / **42504px** mobile. Mobile rail shows roughly two dozen section buttons before content. [stationary-record.tsx](../../apps/web/components/stationary-record.tsx), `.stationary-record-layout`, `.stationary-section-rail` in [styles.css](../../apps/web/app/styles.css). Calls/open reports likewise stack without bounded desktop collections in [assigned-calls.tsx](../../apps/web/components/assigned-calls.tsx) and [open-reports.tsx](../../apps/web/components/open-reports.tsx). | Consider an active-section workspace or bounded desktop content panel and compact mobile navigation. Preserve drafts, section error counts, field targeting, and signing access. Confirm organization with realistic reports; mobile vertical scrolling itself is allowed. |
| UI-026 / P1 | **Readable mobile labels/alignment:** vital label/unit text reaches the adjacent field. | **Browser + Source.** At 390px, “Respiratory rate breaths/min” runs into the neighboring GCS total score label. `.vital-dialog .vital-field-label { white-space: nowrap; }` combines with two columns from 360px. [styles.css](../../apps/web/app/styles.css), vital dialog in [page.tsx](../../apps/web/app/page.tsx). | Allow label/unit wrapping or change columns at the necessary width. Verify 360/390px, Swedish labels, and enlarged text with each label clearly attached to its input. |

### Editing, navigation, and keyboard behavior

| ID / priority | Rule and finding | Evidence | Intended resolution and verification |
| --- | --- | --- | --- |
| UI-018 / P1 | **Protect edits when leaving:** mode changes can discard drafts without a prompt. | **Browser + Source.** Change Settings Brand text to “Unsaved audit brand”; switch Stationary → Admin → Agency Settings: value returns to “Example EMS”. [clinician-session-gate.tsx](../../apps/web/components/clinician-session-gate.tsx) unmounts Admin/Review. [agency-settings.tsx](../../apps/web/components/agency-settings.tsx) holds drafts only in state and reloads on language changes. Form's `beforeunload` warning does not cover same-page mode switches; validation has no unload guard. Catalog retains a scoped sessionStorage snapshot, so it does not have the same unconditional loss. [form authoring](../../apps/web/components/stationary-form-authoring.tsx), [validation authoring](../../apps/web/components/validation-authoring.tsx), [catalog authoring](../../apps/web/components/catalog-authoring.tsx). User/role selection/close handlers clear local editors without dirty checks in [admin-directory.tsx](../../apps/web/components/admin-directory.tsx). | Share dirty-state/navigation protection with Save/Discard/Stay where appropriate. Preserve drafts on benign tab switches. Verify mode/language changes, selection, reload, logout; retain clinical autosave and distinguish retained local work from server persistence. |
| UI-019 / P1 | **Refresh preserves unsaved edits:** Review policy reload overwrites its draft. | **Browser + Source.** Select clearance “automatic” without saving, dispatch window focus: value resets to “confirm”. Review refreshes on focus/every 15 seconds; effects unconditionally call `setClearanceDraft` / `setDeadlineHours`. [review-shell.tsx](../../apps/web/components/review-shell.tsx). **Source-only:** saved-analysis reload also sets editable name/share/definition on refresh in [review-analysis-builder.tsx](../../apps/web/components/review-analysis-builder.tsx). | Separate fetched snapshots from dirty drafts. Test focus/timed refresh while editing clearance, deadline, and saved analyses, including concurrent server updates/save conflicts. |
| UI-020 / P1 | **Preserve list scroll on return:** full-report navigation resets queue position. | **Browser + Source.** Open View PCR-10 after scrolling; close full report: document `scrollY` changes **1497 → 0**. `closeReport` restores trigger focus with `preventScroll: true` but stores/restores no list scroll; the shorter report clamps document scroll. [review-shell.tsx](../../apps/web/components/review-shell.tsx), [interaction tests](../../apps/web/e2e/review-call-window.spec.ts). | Preserve/restore the actual queue-container or document scroll alongside filters/page. Verify a lower row on page 2 with filters, inspector open/closed, and resize to mobile. |
| UI-021 / P1 | **Complete keyboard control semantics:** exceptional-value popups expose menu roles without menu behavior. | **Source.** `role="menu"` / `menuitem` popups have click/open handlers but no arrow navigation, initial item focus, Escape handling, or return focus when the selected item unmounts. [stationary-coded-field.tsx](../../apps/web/components/stationary-coded-field.tsx), [stationary-scalar-control.tsx](../../apps/web/components/stationary-scalar-control.tsx). Mobile vital menu in [page.tsx](../../apps/web/app/page.tsx) also needs verification against its enclosing dialog Escape handler. | Reuse a complete shared menu/popover or simpler native semantics. Browser-test opening, navigation, selection, dismissal, and focus in standalone fields and nested dialogs. |
| UI-022 / P1 | **Keyboard access to meaningful help:** some help appears only on pointer hover. | **Source.** Review criterion tooltip CSS reveals only on hover despite its focusable trigger. [review-workspace.css](../../apps/web/app/review-workspace.css), [review-shell.tsx](../../apps/web/components/review-shell.tsx). [StationaryPickerLegend](../../apps/web/components/stationary-picker-label.tsx) is not focusable; tooltip visibility follows label hover in [styles.css](../../apps/web/app/styles.css). Validation help relies on `title` in [validation-authoring.tsx](../../apps/web/components/validation-authoring.tsx). | Provide an accessible help trigger or focus/expanded treatment for keyboard and touch; preserve assistive descriptions. Test revealing/dismissing help without a mouse or clipped popups. |
| UI-025 / P1 | **Restore useful focus after detail/editor closes:** Admin paths remove the focused control without a return target. | **Source.** Users Close/successful identity Save call `setEditing(null)`; role save/cancel/history-close remove editors without restoring focus. Form Keep section closes its focused confirmation without returning to the removal trigger. [admin-directory.tsx](../../apps/web/components/admin-directory.tsx), [stationary-form-authoring.tsx](../../apps/web/components/stationary-form-authoring.tsx). | Store stable initiating references/identities and return focus to the relevant action/row. Browser-check save/cancel/close/removal, failed operations, row refresh, and deletion of the initiating row. |

### Standalone views and visualizations

| ID / priority | Rule and finding | Evidence | Intended resolution and verification |
| --- | --- | --- | --- |
| UI-023 / P2 | **Agency branding in previews:** standalone form preview loads configuration but applies only language. | **Source.** [admin-preview/page.tsx](../../apps/web/app/admin-preview/page.tsx) never applies agency appearance/colors; its new page therefore uses root defaults. [StationaryFormPreview](../../apps/web/components/stationary-form-preview.tsx) does not apply appearance either. Standalone Review call does apply appearance. | Apply shared agency appearance/context. Browser-check text, active/inactive/destructive controls, and focus with the parent's nondefault palette. |
| UI-024 / P2 | **Adapt charts without shrinking text:** SVG labels scale down with the 720-unit viewBox. | **Source.** [review-volume-chart.tsx](../../apps/web/components/review-volume-chart.tsx), [review-analysis-chart.tsx](../../apps/web/components/review-analysis-chart.tsx), width-100% `.review-volume-chart` in [review-workspace.css](../../apps/web/app/review-workspace.css). At approximately 300px width, a 12-unit label scales to about 5px; categorical labels also truncate to 38 characters. Exact-value tables are existing useful fallbacks. | Use responsive geometry, an adequately sized horizontally scrollable chart, or readable mobile table presentation. Browser-check nonempty volume/distribution/workload results and long labels, enlarged text, full labels/exact values. |

## Remaining verification and suspected risks

These are coverage gaps, not additional confirmed defects:

- Check 320/360px phones, intermediate/tablet widths, small desktop heights,
  200% text/zoom, and real on-screen keyboards. Two viewports cannot establish
  every breakpoint or action's reachability.
- Exercise conditional user/session/security/ownership, role history, catalog
  group/custom/code-list, selected validation-rule, nested/repeating clinical,
  and custom-field editors. UI-005's source extensions need browser confirmation.
- Verify drafts survive within-editor tab switches. Admin's visited-panel
  mounting and catalog's scoped stored draft are useful existing protections.
  Check values committed on blur when switching selection, including invalid
  JSON and replacement of an unfinished custom-element editor.
- Verify validation errors identify affected tabs/sections and reach the field.
  Stationary section error counts, form diagnostics, and catalog translation
  navigation are existing aids; check hidden-tab errors and save failures.
- Exercise pending/success/failure, stale revisions, offline recovery/conflicts,
  Save & close, and signing. Clinical autosave already distinguishes Saved,
  Saving, Pending sync, and Conflict; preserve it and verify closing/reopening.
  No false-success defect was established by this audit.
- Check Review filters/page alongside UI-020, plus mobile inspector/full-report,
  findings/timeline overlays, focus, Escape, and resize with populated reports.
- Inspect nonempty charts/workload, saved-analysis refresh, CSV errors, and
  realistic routing/backlog counts. If retrospective is reconnected, review
  its preview/runs bounds and table adaptation.
- Exercise camera/microphone permissions, real hardware, media viewers/deletion,
  long captions, interrupted capture, and offline uploads. Only initial media
  dialogs were rendered; hardware capture was not exercised.
- Browser-check feedback selection/pending/errors, language-menu keyboard use,
  mandatory-password/no-workspace, standalone preview/call loading/errors,
  and not-found. No separate not-found defect was established from source.

## Maintaining the backlog

Add stable IDs, the agreed rule, concrete evidence, priority, and an intended
resolution for newly discovered candidates. Separate suspected issues and
unexercised states from confirmed findings. Existing departures are remediation
work, not examples to copy. When resolved, retain the ID and record the change
and relevant browser/behavior verification, including viewport, palette, and
fixture/state. Keep unrelated redesigns outside feature work.
