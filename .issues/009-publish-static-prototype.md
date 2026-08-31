## What to build

Publish the completed browser-only MVP at a stable HTTPS URL without adding a backend dependency. The deployed artifact must preserve the synthetic safety labeling, bundled terminology assets, local persistence, and complete tested phone journey.

## Acceptance criteria

- [ ] A production static build succeeds without requiring the NestJS API, PostgreSQL, Supabase, authentication, or runtime NEMSIS access.
- [ ] The deployed HTTPS URL opens directly into the synthetic encounter on Android Chrome.
- [ ] Medication and procedure terminology search works from bundled local assets.
- [ ] Browser-local autosave, refresh recovery, completion, continue editing, and reset work on the deployed artifact.
- [ ] The persistent synthetic/not-for-clinical-use notice and prototype labeling remain visible in deployment.
- [ ] A deployment smoke test exercises the core journey without backend services.

## Blocked by

- Blocked by `008-complete-accessible-phone-journey.md`
