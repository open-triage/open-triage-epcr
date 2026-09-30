# NEMSIS custom Binary and Other

The pinned NEMSIS 3.5.1 `commonTypes_v3.xsd` defines custom datatype codes
`9902001` (Binary) and `9902007` (Other). `eCustom_v3.xsd` stores the custom
result in `CustomResults`, an XML string of 1–100,000 characters. The schema
does not define a file attachment, MIME type, or nested document for either
category.

An administrator creates a standalone single-value custom definition and
chooses its datatype and identifying-data classification before publication.
The published definition and identity are immutable. Binary uses a file input
of 1–75,000 bytes. The browser encodes those bytes as canonical padded base64,
whose length is at most 100,000 characters. The API checks that representation
again and stores the decoded bytes in the existing `value_binary` column. The
canonical encounter document and report API carry the same base64 text for
save and recovery. File names and MIME types are not retained.

Other uses a text input and the existing `value_text` column. It accepts a
nonempty string of at most 100,000 characters, with any published minimum,
maximum, and pattern constraints. It is not interpreted as JSON or XML.
The same text validation runs in preview, Mobile, Stationary, and the save API.
Both categories retain the published identifying-data flag used by canonical
and analytical projections.
