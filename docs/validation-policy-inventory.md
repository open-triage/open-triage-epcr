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

Catalog authoring continues to own labels, datatypes and storage identity, intrinsic structure, code lists, code labels, enablement, and defaults. Form authoring continues to own selection, ordering, layout, and visibility.
