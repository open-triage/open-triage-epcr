# Swedish NEMSIS 3.5.1 catalog seed

`catalog_nemsis-3.5.1.json` is grouped by NEMSIS domain. Every entry carries its
stable element ID, group ID, or list ID plus code-system/code tuple. The English
NEMSIS source is retained by the installer in `reviewedSource`; editing Swedish
wording never changes clinical identity, units, or code values.

This is a first-pass working vocabulary. Entries with `reviewPending` need review
by a Swedish clinician or coding specialist before being treated as approved
terminology. Some descriptions intentionally summarize the English definition
rather than asserting an unverified clinical translation. US-specific concepts
retain their US identity. The administrator can clone the published catalog,
correct a Swedish label or description in Catalog authoring, then publish a new
agency version. The initial form definitions also contain Swedish section and
field wording; authors can refine those through Form authoring.

Run `npm run audit:localization -w @open-triage/database` to obtain machine-readable
coverage. `missing` lists absent identities; `reviewPending` lists candidates that
are present but need a terminology decision. Installation rejects a missing or
malformed seed, but review candidates remain visible in the audit without blocking
installation. The catalog loader is insert-only for an existing sealed release;
reruns do not change existing published catalog or agency edits.

## Form and Validation wording

`form-validation_sweden.json` and `form-validation_nemsis-full.json` are keyed by
stable section, field, and rule identities in their owning install definitions.
The loader verifies each English source snapshot before attaching Swedish text.
The source definitions, rule expressions, targets, severity, and clinical codes
remain unchanged. Fresh installations receive the text in pinned Form and
Validation versions; existing published versions and agency edits are preserved.
Administrators can clone and edit the installed wording in Form and Validation
authoring, then publish a new version.

Run `npm run audit:form-localization -w @open-triage/database` to list coverage
and entries with `reviewPending`. Catalog count rules have Swedish wording based
on the pinned catalog term. NEMSIS conditional statements keep their original
English clinical assertion within a Swedish review prompt until clinical and
terminology review confirms a precise translation. US-specific terms and
conditions are intentionally preserved in those assertions. The review list is
part of the seed audit and is not an approval claim.
