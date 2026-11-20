# UI language dictionaries

Add a UTF-8 JSON file named with a language code, for example `fr.json`, in this directory. Other JSON filenames, such as `sv_edit.json`, are ignored so translation drafts can stay alongside the published files. The next web/API build discovers it and adds it to the Agency Settings language picker. Restart development servers after adding or removing a file. A deployment needs both the web and API built from the same set of message files and the bundled-language database migration applied.

Use flat message keys and string values, or `{ "one": "...", "other": "..." }` for plural text. `en.json` is required. Missing keys in a new language use the English message, so a partial dictionary is usable. Existing clinical catalog, form, and validation-rule translations are separate from these UI dictionaries; languages without clinical translations display the English clinical source text.

Edit WEST-A clinical wording, catalog labels and WEST-specific interface messages in the [WEST-A definition](../../../defines/decision_support/west-a-2025.json). Each translated field has an `en` and `sv` value. The app selects the agency language and falls back to English.

The generated language manifests in `apps/web/app/message-dictionaries.generated.ts` and `packages/contracts/src/ui-languages.generated.ts` are refreshed by the contracts build. Do not edit them by hand.
