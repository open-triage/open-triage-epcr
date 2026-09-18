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

Legacy reports without a pinned Validation version continue to evaluate their immutable Catalog/Form projections. Reports with a pinned Validation version evaluate requiredness and documented cardinality only from that bundle. This preserves old records while preventing duplicate findings for current workflows.

Catalog authoring continues to own labels, datatypes and storage identity, intrinsic structure, code lists, code labels, enablement, and defaults. Form authoring continues to own selection, ordering, layout, and visibility.
