# Hackathon fictional patients

The Patient resources were extracted from the public worked examples on
2026-10-19, with generated XHTML narrative omitted:

- https://hackathon2026.vadimperetok.in/fhir/Bundle/andrea-cross-border
- https://hackathon2026.vadimperetok.in/fhir/Bundle/arne-complex-care
- https://hackathon2026.vadimperetok.in/fhir/Bundle/ville-difficult-airway

These are synthetic examples, not real patient records. No service credentials
are needed or included. Tests consume these pinned resources without networking.
All ten shared dispatch examples use these three identities, including their
identifier, names, date of birth, sex and contact details. The original Andrea
and Arne examples remain first; the other eight were shuffled once to give
four Andrea, three Arne and three Ville samples. Runtime call generation
continues to select randomly across all ten samples. Ville uses the supplied
coordination number `201304822172` and birth date `2013-04-22`; the birth date
is not inferred from the identifier. Arne's second given name is Gustav. The supplied international telephone numbers and email are valid catalog values.
Home street and postal code are retained (postal spaces removed for the NEMSIS
ZIP format). Swedish city/county/state/country have no verified mapping in the
installed US GNIS/ANSI lists: they stay undocumented or use a catalog-permitted
Not Recorded value. The complete original address remains in the pinned Patient
reference for future EPS display; it is never substituted with a random US home.
Repeated-phone regression data lives separately in
`tests/fixtures/repeated-phone-dispatch.json`. US scene details describe the fictional encounter location.


The normal dispatch projection generates the browser and seeded encounter
fixtures. The shared generation/Populate engine preserves dispatch patient
identity and derives age at dispatch from birth date, rather than randomizing
individual demographic fields. Required unavailable demographics use permitted
absence values. Coded inequality repair selects an enabled alternative disposition
when active rules require one; incompatible protected clinical values still fail
validation rather than being overwritten. Existing synthetic labelling, expiry, credential
bootstrap and fixture identities are unchanged.

Complete worked documents (including narrative) for the read-only EPS display
regressions are pinned under `apps/api/tests/fixtures/hospital/`. They were
retrieved from the same public Bundle endpoints on 2026-10-19. The adapter reads
`$samples` and `$exchange` listings, then indexes identifiers from each document's
Composition subject. Listing display identifiers are never used for matching.

`eps-clinical-crosswalks.json` is a `clinicalMappings` fragment for these fictional
examples: two simplified allergy codes and 18 RxNorm medication ingredient codes.
Merge the member into an EPS canonical mapping through the application; the fragment
is not independently importable as a canonical package. RxNorm targets were checked
against the linked NLM properties endpoints on 2026-10-19. Source ATC/SNOMED codes
come from the public worked bundles. Allergy targets use the pinned NEMSIS suggested
lists. Every mapping explicitly declares its broader relationship and reference.
Medication imports record identity only, without dose, route or frequency; source
regimens and allergy reaction details remain in protected provenance. No custom
fields or inferred negative-history mappings are included.

The fragment also includes five problem-list crosswalks to `eHistory.08`:
hypertension, ADHD, prostate cancer, angina and heart failure. Targets use the
pinned NEMSIS Medical/Surgical History suggested list. Other problems remain
unmapped where that list lacks a suitable target; in particular, its diabetes
entries assert complications and must not be used for an unspecified diabetes
source. Resolved and remission conditions remain view-only.
