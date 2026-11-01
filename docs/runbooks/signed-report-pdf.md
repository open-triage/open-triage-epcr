# Signed report PDF inspection

Review's **Inspect signed PDF** action renders a specific snapshot and signed
amendment sequence. The API is
`GET /api/review/reports/:reportId/snapshots/:snapshotId/pdf?amendmentSequence=0&language=en&dataset=real`.
All query dimensions are explicit; supported PDF languages are English and Swedish.
The request uses the live Review report, agency, dataset and identifying policy.
An own-report reviewer can inspect their report; other reviewers also need
identifying authority. Successful retrieval records patient access to the snapshot.

The renderer verifies the signed integrity-manifest hash and reads bounded immutable amendments,
and the pinned catalog/form definitions. For each amendment it verifies the canonical
digest using the original ordered changes in the immutable signing audit event,
and requires an exact multiset match with the amendment change rows. This catches
extra inserted rows as well as inconsistent evidence. Missing or duplicate audit
evidence fails explicitly with administrator guidance; snapshot-only inspection
remains available independently. Database regressions reject amendment/change
mutation and verify original-version stability.
The renderer never reads current draft values or
current note text. New signatures bind the signer's display name and supplemental
NOT/pertinent-negative codes in `clinicalContentVersion: 2`. Legacy manifests remain eligible when every occurrence includes the supplemental
code/display keys (including explicit nulls), or there are no occurrences, and
the signed notes array is present. A scalar can carry supplemental qualifiers;
its value kind alone cannot prove their absence. Manifests that cannot prove
content completeness fail explicitly; they are not rewritten or
silently filled from current rows. Older custom definitions without an immutable
catalog snapshot also fail explicitly.

PDFs are rendered on demand into a completed buffer and returned with private,
no-store headers. There is no additional persisted copy, artifact lookup route,
or independent retention period. The browser holds bytes only in an object URL
while the preview is mounted; closing or leaving releases it. A downloaded copy
is an explicit user action, like other report exports.

Unsupported font glyphs, unavailable pinned definitions, invalid version evidence,
and content exceeding 500 pages or two million rendered characters fail without
returning partial PDF bytes. Authored source text is not translated or shortened.
DejaVu Sans fonts and their distribution license are bundled with the API.

Photos are loaded only by the signed manifest's references from the authorized
report's canonical storage, and their exact byte length and SHA-256 are verified.
JPEGs are fully decoded before embedding their unchanged canonical bytes. Missing,
corrupt, undecodable or excessive media fails with an actionable localized finding;
no partial artifact or silently reduced photo set is returned. Successful photo
access is recorded through the existing media-access audit. Audio bytes are never
loaded: timestamp and signed duration appear with an explicit localized statement
that the recording was not transferred and no transcription was generated.
New signatures pin audio duration; legacy audio manifests without duration fail
explicitly instead of using current metadata or rewriting signed history.

The current policy is explicitly simulated: PDF at most 10 MiB; total photo bytes
25 MiB; 20 million decoded pixels per photo and 80 million total. The existing
500-page/two-million-character bounds also apply. The preview shows these limits
before download. These bounds are operational protections, not verified COS
acceptance; ticket 024 must verify the receiving system before live delivery.
All signed photos are required. An oversized PDF must be resolved against supported
limits rather than silently compressed, truncated or declared transferred.
No artifact copy is persisted, so existing report/media retention remains authoritative.

For human layout review, build the API then run
`node apps/api/scripts/render-signed-pdf-preview.mjs /tmp/signed-pdf-preview`.
The fixture is fictional and exercises a custom field, twelve repeated entries,
a long authored note a signed correction, two fictional demonstration photos and audio metadata. The script produces English and
Swedish PDFs and page images. The required browser preflight includes the preview
journey and downloadable bytes; PDF reader tests verify text and pagination.
