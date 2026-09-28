# Problem Statement

OpenTriage's interface and clinical definitions are predominantly English. An agency cannot select Swedish consistently across clinical documentation, administration, setup, validation findings, and errors. Labels are spread between application code and authored definitions, and some application behavior derives values from English labels. Date and number formatting also depends on browser defaults, while clinical timestamp controls use the device's time zone.

Swedish agencies need a complete initial translation that they can review and refine. Administrators need to edit clinical terminology in the existing authoring interfaces, identify missing or outdated translations, and publish changes without altering clinical codes or the definitions attached to existing reports. Translation sources must be human-readable JSON, with a clear distinction between application-release assets and installation seeds.

# Solution

Localize the entire application, with English as the base and default language and Swedish as the first additional language. An administrator selects one agency-wide language in Agency Settings. Regional format and time zone are separate agency settings; there is no user or device language override and no additional owner-setup selection step.

Ship interface translations as readable JSON with application releases. Seed catalog, form, and validation translations from readable JSON at installation. After installation, administrators edit definition translations exclusively through the relevant authoring interfaces, switching between English and a localization. Each translation belongs to the same immutable published version as its owning definition.

Display the selected language when available, otherwise English, otherwise a stable identifier. Warn about missing English text, missing text in the agency language, and translations needing review after an English source change. These warnings do not block saving, publishing, or selecting a language.

Provide an initial Swedish translation of the whole shipped experience, using consistent Swedish ambulance-care terminology while preserving the meaning of clinical codes. Apply agency formatting and time-zone settings consistently without converting measurement units or changing canonical clinical values. Keep settings stable during active work and retain the definitions pinned to each report.

# User Stories

1. As an administrator, I want English to be the default language, so that installing or upgrading the application does not unexpectedly switch its language.

2. As an administrator, I want to select Swedish in Agency Settings, so that the agency has one consistent application language.

3. As a clinician using a shared device, I want the agency's language to apply without a personal preference, so that shared devices present a consistent interface.

4. As an administrator, I want to choose a regional format independently of language, so that English text can coexist with Swedish date and number conventions.

5. As an administrator, I want a preview of the regional format's dates, times, and numbers, so that I understand the setting before saving it.

6. As an administrator, I want to select the agency's named time zone, so that clinical timestamp entry and display are consistent across devices.

7. As a clinician, I want time pickers to use the agency time zone without displaying it on the picker, so that the controls remain uncluttered.

8. As a clinician, I want decimal entry to accept a comma or a point unambiguously, so that familiar notation does not cause an incorrect measurement.

9. As a clinician, I want measurement units to remain defined by the element catalog while their names are translated, so that language changes do not convert measurements.

10. As a mobile clinician, I want navigation, dialogs, documentation controls, status messages, and errors in Swedish, so that the complete mobile workflow is usable in my agency's language.

11. As a desktop clinician, I want the stationary workflow to use the same language and terminology, so that moving between layouts does not change meaning.

12. As an administrator, I want login, setup, administration, and authoring controls to be localized, so that localization covers the whole application.

13. As a screen-reader user, I want accessible names, instructions, and announcements localized alongside visible text, so that the experience is consistent across interaction methods.

14. As a clinician, I want clinical choices and their search results to use localized labels while retaining stable codes, so that I can find and record the intended concept.

15. As a clinician, I want validation findings and user-facing server errors in the agency language, so that I can understand and act on them.

16. As a catalog author, I want to switch between editing English and a localization, so that I can maintain source wording and translations in one interface.

17. As a catalog author, I want to translate element labels, descriptions, coded-choice labels, and unit names, so that clinical vocabulary is consistent.

18. As a form author, I want to translate authored headings, label overrides, and help text, so that form-specific wording is localized.

19. As a validation author, I want to translate rule names and messages without modifying expressions, so that localized guidance preserves the same validation behavior.

20. As an author, I want translations to share their definition's draft and publication lifecycle, so that I can review a complete version before making it available.

21. As an administrator, I want existing read, write, and publish permissions to govern translation editing, so that adding a language does not grant new authority.

22. As an author, I want warnings beside missing English and agency-language labels, so that fallback text cannot hide incomplete authoring.

23. As an author, I want a filterable completeness summary, so that I can systematically find missing or outdated translations.

24. As an author, I want to save and publish incomplete translations with warnings, so that I can improve coverage incrementally.

25. As a clinician, I want missing localized text to fall back to English and then a stable identifier, so that a field or finding remains identifiable.

26. As a translator, I want English source changes to flag existing translations for review without deleting them, so that I can assess whether their meaning still matches.

27. As a translator, I want to confirm an unchanged translation or replace it, so that review status accurately reflects my work.

28. As an administrator, I want all post-installation definition translation editing to happen through the interface, so that routine maintenance requires no JSON editing or import process.

29. As an installation maintainer, I want readable translation JSON seeds, so that the supplied English and Swedish content can be inspected and maintained with the other installation definitions.

30. As an administrator, I want application upgrades to preserve agency-authored translations, so that deployment cannot overwrite local terminology.

31. As an application maintainer, I want interface translations to ship with releases, so that interface wording does not require publishing clinical definitions.

32. As a clinician working offline, I want cached settings and translations available with the report's definitions, so that the language and interpretation of data remain consistent without connectivity.

33. As a clinician entering data, I want administrative language, format, and time-zone changes deferred until the next workspace load, so that active documentation is not reinterpreted midway through entry.

34. As a clinician, I want localization and formatting changes to preserve unsaved work and canonical values, so that presentation changes do not change my report.

35. As a clinician reviewing an existing report, I want its original definition versions retained, so that later terminology edits do not change the wording attached to its clinical configuration.

36. As a clinician reviewing a report whose definitions have no Swedish translation, I want English fallback within the Swedish application interface, so that historical definitions remain usable.

37. As a Swedish reviewer, I want concise, natural Swedish and consistent clinical terminology, so that the initial translation is practical to review and use.

38. As a Swedish reviewer, I want ambiguous translations identified for review and US-specific concepts translated faithfully, so that linguistic adaptation does not silently substitute a different clinical concept.

39. As a clinician, I want authored free-text documentation and agency-entered names preserved, so that selecting a language does not rewrite source content.

40. As an administrator upgrading an installation, I want existing formatting and time-zone behavior preserved until explicitly configured, so that an upgrade does not silently change timestamp interpretation.

# Implementation Decisions

## Approved module boundaries

The following five modules and testing all five were explicitly approved during PRD preparation. They describe responsibilities and stable interfaces, not a requirement for five new packages.

| Module | Responsibilities | Interface boundary |
| --- | --- | --- |
| Localization runtime | Resolve UI messages and definition text; apply fallback; interpolate parameters; provide localized error presentation | Accept stable message or definition identity, language, owning version where applicable, and named parameters; return display text and resolution metadata |
| Agency regional settings | Maintain language, regional format, time zone, and workspace settings snapshots; centralize formatting and input parsing | Extend existing settings read/save contracts and public installation configuration; expose explicit formatting, parsing, and wall-clock-to-instant operations |
| Definition authoring | Edit localized catalog, form, and validation content; track source review; report completeness; preserve lifecycle and authority | Extend existing definitions, draft contracts, validation diagnostics, and publication artifacts rather than adding an independent translation lifecycle |
| Installation translation seeds | Validate and load readable definition translations at installation; maintain initial Swedish content and release-bundled UI dictionaries | Resolve seeds against stable identities, report structural errors and coverage separately, and attach translations during initial definition publication |
| Clinical and offline integration | Apply localized presentation across mobile, desktop, administration, and errors; retain report pins and cached translations | Consume localization and settings snapshots through existing report configuration, browser persistence, synchronization, and rendering boundaries |

## Language and agency settings

- English is the base and default language. Swedish is the first additional UI language. Keep language identifiers distinct from regional-format identifiers; a Swedish translation is not itself a time-zone choice.
- Agency Settings is the configuration surface. There are no personal overrides, browser language selectors, or new owner-setup language questions.
- Regional format controls date, time, and number presentation as one setting rather than independent formatting knobs. Swedish regional formatting is required; an English regional option must also be available. The exact supported English regional variants are an implementation detail, not an agreed product restriction.
- Store configured time zones as named zones, such as Europe/Stockholm, rather than fixed offsets. Clinical timestamp display and entry use the configured zone regardless of the device zone. Do not add zone text to pickers.
- Before explicit regional configuration, retain current formatting and device-zone behavior. Do not infer a configured Swedish region or time zone merely because Swedish is selected. This compatibility behavior avoids a new setup gate or silently changing existing timestamp interpretation.
- Extend the current revision-checked, authorized agency-settings save and audit behavior. Include effective non-sensitive localization settings in public installation configuration so login and other unauthenticated screens can use the agency language. Use English if agency configuration is unavailable.
- A workspace captures its effective settings when loaded. A saved administrative change is available to subsequent workspace loads; it must not change an already open workspace's language, decimal interpretation, or time zone. A workspace load does not repin a report's clinical definitions.
- Offline loads use the last successfully downloaded configuration. Reconnection can refresh cached configuration for the next load without mutating active entry controls.

## Translation content and JSON contracts

- Use human-readable UTF-8 JSON grouped by language and domain. Separate interface dictionaries from catalog, form, and validation seeds. Stable ordering and meaningful keys should make review and diffs practical.
- Use semantic stable keys for interface messages, not English sentences as identity. Support named parameters and count-dependent message variants so callers do not concatenate translated sentence fragments.
- Key definition translations by their owning definition and stable identities: element IDs, scoped group or section identifiers, form field keys, and validation rule IDs. Identify coded choices by their list or element scope plus code system and code. A translated label is never an identifier.
- English remains the editable base definition text. Localization records contain translated text and enough source-review metadata to determine whether the English source changed. Avoid an independently editable duplicate English source for the same definition field.
- Include schema versions and owner references in seed contracts. Check unknown references, conflicting duplicate identities, malformed translation structures, and incompatible message parameters before loading or publication.
- Required translatable labels that are absent, empty, or whitespace-only count as missing. Optional text absent in English does not require an invented translation. Completeness rules should distinguish those cases.
- UI dictionaries ship with the application. Clinical definition JSONs seed a new installation and are not a synchronization source for an existing agency. Do not add an administrative JSON importer, merge screen, or upgrade-time overwrite mechanism.

## Authoring, persistence, and publication

- Add a language editing selector to the existing Catalog, Form, and Validation editors. Changing the editing language changes which content is edited, not the language of the surrounding application interface.
- Catalog translations cover element labels, descriptions, choice labels, and unit names. Include displayed catalog-derived group and list names where required for complete clinical localization. Form translations cover authored section headings, help text, and label overrides. Validation translations cover names and user-facing messages.
- Carry localized text and review metadata through draft creation, cloning, revision-checked save, read-only inspection, validation, publication, and activation. Extend existing persisted definition representations and public contracts accordingly. Exact physical storage changes are left to implementation review; there is no independent translation-version entity required by this design.
- Reuse any existing form-locale representation where compatible after checking its contract and publication behavior. Its current presence does not establish a complete runtime localization system.
- Preserve the existing catalog-to-form binding. Correcting a catalog translation requires publishing a new catalog version and activating a compatible form that references it. Form and validation translations follow their corresponding existing lifecycle.
- Published localized content participates in the owning artifact's integrity and immutability guarantees. Existing published artifacts retain their identity and content; compatibility readers treat absent localization metadata as no available localization rather than rewriting historic records.
- Translation editing does not grant authority to alter element identity, code values, storage semantics, intrinsic structure, rule expressions, or permissions. Existing read/write/publish capabilities and organization boundaries continue to apply.
- Distinguish advisory localization diagnostics from structural or integrity errors. Missing English or selected-language text and review flags do not block saving or publishing. Invalid references or malformed structures remain ordinary validation errors.
- Show warnings beside affected content and in a filterable summary. Evaluate completeness against actual stored text, not resolved fallback text, and identify which language is missing. Re-evaluate selected-language completeness when the agency language changes.
- A change to English source text marks an existing translation as needing review. Retain and display that translation. An author can edit it or explicitly confirm it against the current source, using normal draft saving and publication.

## Rendering, errors, and data integrity

- Resolve text in this order: selected language, English, stable identifier. For English, resolve base text and then the identifier. A translation awaiting review remains eligible for display.
- Resolve report content only from its pinned catalog, form, and validation versions. The application's surrounding interface uses the workspace's agency language. Do not fetch a newer catalog solely to supply a missing historical translation.
- Preserve existing presentation precedence, including form-specific label overrides, while localizing each applicable source. Document exact resolver precedence during implementation and test it so fallback does not accidentally defeat authored overrides.
- Inventory and replace English-label-dependent logic, including procedure outcomes, success values, special choices, and state-derived CSS or behavior. Use stable codes or internal states for behavior, and translate only their display text.
- Use stable error identifiers and structured parameters for user-facing platform/API errors, with compatible English fallback for legacy or unknown errors. Validation findings retain stable rule/version identity so their displayed message can be resolved from the report's pinned validation definition.
- Localize search and selection presentation consistently with rendered labels while preserving code identity and existing search capabilities. Verify Swedish characters and direct code searches. Do not make persistence depend on translated search text.
- Preserve canonical numeric values and timestamps. Decimal entry accepts either a comma or point where unambiguous; reject ambiguous mixed-separator input rather than guessing. Locale formatting must not leak into protocol values, report identities, or canonical serialization.
- Measurement units remain catalog-defined. Translate names without introducing measurement-system selection or automatic conversions.
- Translate visible UI text, accessible names, instructions, announcements, empty/loading/error states, and user-facing installation/demo surfaces. Arbitrary free-text notes, names, uploaded content, source provenance, and machine identifiers are not automatically translated.
- Daylight-saving entry policy is an implementation recommendation from the agreed specification: reject nonexistent wall-clock times and require explicit disambiguation for repeated times. Keep that handling separate from ordinary picker labels and verify round trips preserve the intended instant.

## First Swedish pass and rollout

- Inventory all shipped interface messages and all translatable installation-definition content. Cover mobile and stationary clinical workflows, login/setup, administration, catalog/form/validation authoring, user-facing errors, and accessibility text.
- Translate the complete shipped NEMSIS EMS catalog, including its 453 elements and applicable choices, descriptions, unit names, and displayed group/list labels. Cover both the Sweden and full NEMSIS form and validation sets, plus presentation text used by focused mobile profiles.
- Use natural, concise Swedish, consistent ambulance-care terminology, and a shared reviewed vocabulary. Preserve coded meaning. Translate US-specific concepts faithfully rather than substituting Swedish concepts with different meaning.
- Make ambiguous candidate translations visible as needing review. Do not represent an initial machine-assisted translation as already approved by the agency. Missing entries must remain visible through completeness reporting rather than being concealed by fallback.
- Initial translation deliverables are the release dictionaries, definition seed JSONs, validation schemas/checks, and coverage/review findings. Ongoing definition review and correction happens in the interface.
- Deploy compatibility changes without rewriting published catalogs, forms, validations, report content, or signed artifacts. Application releases can update UI dictionaries but must not silently reseed clinical terminology in existing organizations.
- Cache required UI resources and localized definition artifacts for supported offline workflows. Extend existing protected report caching rather than introducing an alternate report store. Keep integrity metadata, report pins, and settings snapshots consistent.

# Testing Decisions

All five modules are selected for testing. Good tests verify externally observable behavior and integrity guarantees rather than duplicate implementation details or assert incidental component structure.

| Module | Required behavioral coverage |
| --- | --- |
| Localization runtime | English and Swedish resolution; parameter substitution and count variants; selected-language to English to identifier fallback; review-pending text; form override precedence; localized accessible text and errors; code-based behavior independent of labels |
| Agency regional settings | Existing read/write authority and revision conflicts; independent language/region/zone choices; formatting preview; decimal comma/point parsing and rejection of ambiguous input; named-zone date/time round trips and daylight-saving boundaries; preservation of unconfigured behavior; deferred settings application |
| Definition authoring | Language selector edits intended content; draft cloning and publication preserve localization; missing-base and missing-agency-language warnings remain non-blocking; source changes trigger review; confirmation clears the correct flag; permission and organization isolation; immutable published artifacts and stable codes |
| Installation translation seeds | JSON shape and identity validation; matching message parameters; complete inventory and visible coverage gaps; deterministic seed attachment; fresh-install availability; installation reruns and application upgrades preserve agency edits and published versions |
| Clinical and offline integration | Representative mobile and desktop documentation, administration, validation and error flows in both languages; Swedish search and stable-code selection; canonical data unchanged by presentation; historical-version fallback; offline reopen with consistent definitions/settings; reconnection does not reinterpret active input; unsaved work survives normal workspace lifecycle |

Prior art in the repository includes:

- Catalog, form, and validation API authoring tests for immutable versions, stable catalog identity, granular authority, and stale-revision rejection.
- Agency settings API and browser tests for explicit revisioned saves, CSRF handling, configuration projection, and audit behavior.
- Stationary date/time and time-picker tests for timestamp round trips and daylight-saving behavior. Current tests explicitly cover browser-local behavior; retain that compatibility case while adding configured agency-zone behavior, and update normalization expectations for the explicit daylight-saving policy.
- Offline report tests for preserving report identity, pinned definitions, cached live validation messages and integrity metadata, ownership boundaries, and pending changes across storage reloads.
- Existing clinical choice/procedure tests and browser accessibility/deployment checks for end-to-end presentation and code identity.

Completion requires the full inventory to be accounted for, the initial Swedish content to be supplied with unresolved review items visible, and all selected module behaviors to be verified. Runtime missing-text warnings remain non-blocking; malformed artifacts, code/value changes caused by localization, and failed integrity or permission checks are not acceptable completion gaps. Manual Swedish terminology review complements automated checks; tests cannot establish clinical translation quality.

# Out of Scope

- Personal, device-specific, or browser-selected language overrides.
- A new language/region/time-zone selection step in owner setup.
- Independently configurable date, time, and number format templates; regional format is one setting.
- Independently published translation releases for catalog, form, or validation content.
- Post-installation JSON editing/import/export workflows for agency definition translations, automatic translation merging, or release-time reseeding of existing organizations.
- An in-application editor for UI dictionaries; those remain release assets.
- Measurement-unit conversion or a new configurable unit system. Vehicle/unit management is unrelated to this feature.
- Translating or rewriting authored clinical free text, agency-entered names, or uploaded content.
- Replacing clinical code systems, adapting US-specific coded concepts into different Swedish concepts, or changing clinical validation logic as part of translation.
- Retrofitting translations into immutable historical definitions or repinning existing reports to newer wording.
- Additional complete language translations beyond English and Swedish in this first pass.

# Further Notes

- This PRD records the completed localization interview and the explicit approval of all five module boundaries and their test coverage. Earlier ideas about per-user language, owner-setup language choices, and post-installation JSON import were rejected or superseded.
- The final workflow distinguishes release-owned UI wording from agency-owned clinical terminology. The user's original expectation of reviewing readable files informs the seed format; the later decision that ongoing editing always happens in the interface governs the installed product.
- Existing installations can select the Swedish UI after upgrading, but their existing definition versions do not automatically acquire the installation seeds. They must author translations through the normal interfaces and publish new versions. Their historical reports can continue to display English definition content indefinitely under the agreed fallback and pinning rules.
- Some catalog descriptions, unit labels, and displayed group/list names may not currently be exposed by the authoring contract. Extending those presentation fields is necessary for agreed translation coverage, without expanding authority over clinical structure.
- English labels currently influence some application behavior. Resolving those dependencies is a prerequisite for reliable translation, not an optional cleanup.
- Application-released UI wording may change between releases; definition wording remains pinned. Neither translates existing clinical free text. Keep those three kinds of content distinct in implementation and documentation.
- Defaults for an explicitly unconfigured regional format or time zone preserve existing behavior. The precise persisted representation of that compatibility state is an implementation decision; it must not become an implicit Swedish default or a setup blocker.
- Exact physical schema, message-library choice, regional-format option list, and daylight-saving disambiguation presentation remain implementation details. Choose them to satisfy the shared module interfaces and tests above, and inspect relevant framework and database guidance before implementation.
- The scope spans every interface and a large clinical vocabulary. Track inventory and unresolved translation review separately from code completion so apparent coverage does not hide untranslated text or semantic uncertainty.
