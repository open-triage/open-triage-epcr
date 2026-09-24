# Test suites and CI cadence

The test commands deliberately name the kind of coverage they provide. The
root commands delegate to the corresponding workspace command where
appropriate:

| Command | Coverage | Requirements |
| --- | --- | --- |
| `npm test` | Unit tests plus repository workflow-contract tests | Node.js dependencies |
| `npm run test:unit` | Unit tests in every workspace | Node.js dependencies |
| `npm run test:integration` | PostgreSQL integration tests for the database and API | A configured test `DATABASE_URL` |
| `npm run test:helm` | Every behavior test under `deploy/helm/open-triage/tests` | Helm 3.19.0 |
| `npm run test:deployment` | Helm behavior plus the built web deployment smoke test | Helm 3.19.0, a built web export, and Chromium |
| `npm run test:a11y` | Browser journeys containing the maintained accessibility assertions | Chromium |
| `npm run test:e2e:critical` | The sign-in, assigned-call opening, and clinical-note capture journey against a built static web export | A demo-enabled web build and Chromium |
| `npm run test:e2e` | Every maintained non-deployment Playwright test | Chromium |

The deployment workflow runs for every pull request. Pull-request validation
builds the web application with `next build`, serves the exported artifact with
the production static server, and runs `critical-clinical-journey.spec.ts` at
both supported phone viewports. That critical journey signs in, opens the
assigned call, verifies its dispatch context, and captures a clinical note. CI
also runs the
separate production-configuration deployment smoke test.

The complete non-deployment Playwright suite runs after every push to `main`
and on manually dispatched deployment validation. Image publication waits for
that suite on those events. Browser jobs retain Playwright traces, and a failed
job uploads its trace output together with the corresponding web-server log.

CI installs Helm 3.19.0 before linting and rendering the chart and before
running `npm run test:helm`. Adding a `*.test.mjs` file below
`deploy/helm/open-triage/tests` automatically includes it in that command.
