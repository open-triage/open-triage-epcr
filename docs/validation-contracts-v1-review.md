# Validation contracts v1 architecture review

Status: **Architecture review required before merge**  
Designated reviewers: clinical configuration architecture owner and clinical runtime architecture owner

This is the human checkpoint for the first Validation-authoring slice. Approval of
this document in the issue pull request treats only the contracts below as stable.
Later language features must remain backward-compatible or introduce a new
`languageVersion` / compiled `schemaVersion`.

## Review surface

- Source language v1 is exactly `assert present("<catalog element id>")` with an
  optional trailing semicolon. It has no variables, calls, XPath, SQL, or implicit
  applicability clause. Omitted applicability is unconditional.
- The canonical compiled assertion is
  `{ "operator": "present", "elementId": "<stable id>" }`. A compiled rule also
  carries immutable validation-version and rule identities, severity, execution
  targets, primary target, message, and explicit language/schema versions.
- A finding carries validation-version identity, rule identity, severity,
  execution target, message, primary element target with optional occurrence
  context, and a deterministic relevant-input fingerprint.
- `present` means at least one non-`absent` value exists anywhere in the current
  report for the stable element ID. Null/Not Value and Pertinent Negative are
  documented values and therefore satisfy this first rule.
- The same evaluator runs in the browser for `live` and on the server for `sign`.
  Signing fails closed when a pinned bundle cannot be loaded.

## Required human decisions

- [ ] Source spelling and unconditional semantics are approved.
- [ ] Compiled representation is sufficient and deterministic.
- [ ] Finding identity, target, and fingerprint fields are sufficient for future
      navigation and acknowledgement invalidation.
- [ ] Null/Not Value and Pertinent Negative presence semantics are approved.
- [ ] Organization scoping, immutable published identities, and report pinning are approved.

Record approval in the pull-request review and link that review to issue #455.
