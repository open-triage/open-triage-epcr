# CI toolchain pins and failure evidence

Deployment validation treats Actions, executable tools, service containers,
and runtime base images as reviewed source inputs. Mutable major tags are not
accepted in workflow `uses:` entries or container references.

## Reviewed identities

| Boundary | Reviewed identity |
| --- | --- |
| Runner | `ubuntu-24.04` |
| Node.js | `22.23.3`; Docker manifest `sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c` |
| Playwright Chromium | Playwright `1.62.1`, installed from the committed npm lockfile with `npx --no-install` |
| Helm | `v3.19.0` through setup-helm `v4.3.1` at commit `1a275c3b69536ee54be43f2070a358922e12c8d4` |
| Kubernetes validation | kind `v0.31.0`, kubectl `v1.35.0`, and `kindest/node:v1.35.0` at manifest `sha256:452d707d4862f52530247495d180205e029056831160e22870e37e3f6c1ac31f` |
| Kubernetes schemas | kubeconform `v0.8.0-alpine` at manifest `sha256:6b90a5f23d846140ce0194fe050b1995e546eba938f3a6bf10c039dd5e24588f` |
| PostgreSQL | `15.19-bookworm` at manifest `sha256:539ceaaae49b3a7c8a04467cf00cc6788d8e3f1675df41860d86eebc4c40524f` |
| Nginx | `1.29.8-alpine` at manifest `sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de` |
| doctl | `1.173.0` through action `v2.5.2` at commit `3cb3953159719656269e044e0e24ca16dd2a690f` |

Every other external Action is likewise referenced by a full 40-character
commit SHA with its human-readable release in an inline comment. The repository
does not run a floating Supabase CLI or local-stack image in CI: its portable
Supabase migrations execute against the pinned PostgreSQL compatibility image.
If a Supabase CLI or self-hosted service is introduced, it must be recorded in
this table at an exact version and digest and installed through the committed
lockfile where applicable.

## Updating a pin

Dependabot proposes grouped Action, Docker, npm, and Playwright updates each
week. A maintainer must still perform this review before adoption:

1. Read the upstream release notes, security advisories, and breaking changes.
   For Supabase-related inputs, also review the current Supabase changelog.
2. Resolve an Action release tag to its commit with `git ls-remote`; resolve a
   container's exact version tag to its registry manifest digest. Update the
   readable version comment, immutable identity, this table, and lockfile in
   the same pull request.
3. Inspect Action permission changes, install scripts, image architecture, and
   the complete lockfile diff. Never replace a SHA or digest with `latest`, a
   major tag, or an unreviewed branch.
4. Let the ordinary pull-request `Demo validation` workflow prove the update.
   The required gate covers application unit/workflow tests, all isolated
   PostgreSQL lanes, both exact container builds, the critical Playwright
   journey, and Helm validation. Do not merge the update if any lane is skipped
   unexpectedly or fails.
5. Merge only the reviewed PR. Publication and demo deployment remain separate
   provenance-gated operations and reuse the exact validated images.

## Failure evidence

Failure artifacts are named `validation-<source-sha>-<lane>-failure` (database
result artifacts use the same source SHA and lane). They retain TAP test output,
isolated database reports, Playwright traces and server logs, local image
identities and container logs, validation-gate/provenance JSON, Helm output, or
bounded Kubernetes diagnostics as appropriate. Failure evidence is retained
for 14 days; large exact-image handoff artifacts are retained for one day.

Evidence must never contain credentials or clinical content. Kubernetes
collection is therefore limited to resource status, the migration job, events,
Helm history, and already-public image identities. Secret objects and general
application pod logs are deliberately excluded.
