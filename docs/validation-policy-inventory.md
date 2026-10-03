# Validation policy inventory

Clinical and business policy is owned by an immutable, report-pinned Validation version. The migration boundary is:

| Previous check | Current owner | Classification |
| --- | --- | --- |
| Catalog agency requiredness and severity | Generated visible `catalog` Validation rule | Clinical/business rule |
| Catalog documented element minimum and maximum | Generated visible `catalog` Validation rules | Clinical/business rule |
| Form `required` field flag | Generated visible `form` Validation rule | Clinical/business rule |
| Form conditional-required rule | Generated visible conditional `form` Validation rule | Clinical/business rule |
| Form conditional visibility with a hidden value | Derived from the retained visibility expression | Platform integrity; no duplicate editable rule |
| Element datatype, null/absence shape, catalog membership, stable identities, and code-list membership/enablement | Catalog/database checks | Platform integrity |
| Form sections, ordering, field identity, and catalog compatibility | Form publication checks | Transient editor structure/platform integrity |
| Command shape, optimistic revision, authorization, signature attestation, and unresolved merge conflicts | API/database checks | Platform integrity |
| NEMSIS Schematron clinical constraints | Imported visible `nemsis` Validation rules | Clinical/business rules |
| Quality normalization findings | Versioned quality evaluator | Clinical review rules; not completion requiredness |

Documentation and signing evaluate clinical requiredness and documented cardinality only through the report-pinned Validation bundle. Legacy Catalog/Form required flags and NEMSIS structural minima do not add completion findings, including when an authored rule is disabled. Existing signed findings remain immutable. Datatype, value-shape, identity, and hidden-value integrity checks continue to protect stored data.

Generated Catalog occurrence bounds and migrated Catalog/Form requirements use `for each` on their applicability group. Required singleton children inherit their parent's applicability until a repeating or optional group is reached. Medication dosage, for example, is required once a medication row exists even before its mandatory Dosage Group has been created. Optional groups apply only once their own instance exists. An absent applicability group or a group with zero instances has no evaluation scope. An existing empty instance is documented and is evaluated; minimum and maximum counts are independent for each instance. Explicitly authored report-wide rules retain their report-wide meaning.

The shared runtime recognizes older generated NEMSIS Catalog/Form requirements by their original name, message, target, and assertion. It corrects absent scopes and scopes on mandatory singleton children during evaluation without modifying pinned source, compiled artifacts, or hashes. Other explicit scopes take precedence.

Catalog authoring continues to own labels, datatypes and storage identity, intrinsic structure, code lists, code labels, enablement, and defaults. Form authoring continues to own selection, ordering, layout, and visibility.
