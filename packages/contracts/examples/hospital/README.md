# Hackathon fictional patients

The Patient resources were extracted from the public worked examples on
2026-10-19, with generated XHTML narrative omitted:

- https://hackathon2026.vadimperetok.in/fhir/Bundle/andrea-cross-border
- https://hackathon2026.vadimperetok.in/fhir/Bundle/arne-complex-care

These are synthetic examples, not real patient records. No service credentials
are needed or included. Tests consume these pinned resources without networking.
The first two shared dispatch examples use their identifier, names, date of
birth and sex. Arne's second given name is Gustav. The supplied international telephone numbers and email are valid catalog values.
Home street and postal code are retained (postal spaces removed for the NEMSIS
ZIP format). Swedish city/county/state/country have no verified mapping in the
installed US GNIS/ANSI lists: they stay undocumented or use a catalog-permitted
Not Recorded value. The complete original address remains in the pinned Patient
reference for future EPS display; it is never substituted with a random US home.
US scene details describe the fictional encounter location.


The normal dispatch projection generates the browser and seeded encounter
fixtures. The shared generation/Populate engine preserves dispatch patient
identity and derives age at dispatch from birth date, rather than randomizing
individual demographic fields. Required unavailable demographics use permitted
absence values. Coded inequality repair selects an enabled alternative disposition
when active rules require one; incompatible protected clinical values still fail
validation rather than being overwritten. Existing synthetic labelling, expiry, credential
bootstrap and fixture identities are unchanged.
