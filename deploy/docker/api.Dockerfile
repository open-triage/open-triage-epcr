FROM node:22-bookworm-slim AS build

WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

COPY apps/api apps/api
COPY apps/web/messages apps/web/messages
COPY packages/contracts packages/contracts
COPY packages/database/scripts/lib packages/database/scripts/lib
COPY defines/catalog defines/catalog
RUN npm run build -w @open-triage/contracts && npm run build -w @open-triage/api

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=3001

# Install only the three workspaces used by the API and its operational database jobs.
# The web workspace and every development dependency remain in the build stage.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --omit=dev \
      --workspace @open-triage/api \
      --workspace @open-triage/contracts \
      --workspace @open-triage/database \
      --include-workspace-root=false \
    && npm cache clean --force

# Compiled application and contract runtime.
COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY packages/contracts/config packages/contracts/config
COPY packages/contracts/catalog.schema-1.0.0.json packages/contracts/
COPY packages/contracts/examples/dispatch packages/contracts/examples/dispatch
COPY packages/contracts/patient-key.mjs packages/contracts/quality-rules.mjs packages/contracts/validation-group-scope.mjs packages/contracts/quality-normalization-policy.json packages/contracts/

# Assets intentionally retained for deployment jobs and operator runbooks.
COPY packages/database/scripts/bootstrap-synthetic-installation.mjs packages/database/scripts/
COPY packages/database/scripts/synthetic-stationary-definition.mjs packages/database/scripts/
COPY packages/database/scripts/catalog-artifact-sha256.mjs packages/database/scripts/
COPY packages/database/scripts/load-nemsis-catalog.mjs packages/database/scripts/
COPY packages/database/scripts/seed-initial-validation-versions.mjs packages/database/scripts/
COPY packages/database/scripts/seed-install-definitions.mjs packages/database/scripts/
COPY packages/database/scripts/migrate.mjs packages/database/scripts/
COPY packages/database/scripts/lib packages/database/scripts/lib
COPY packages/database/scripts/provision-workload-logins.mjs packages/database/scripts/
COPY packages/database/scripts/project-analytics.mjs packages/database/scripts/
COPY packages/database/scripts/purge-synthetic-records.mjs packages/database/scripts/
COPY packages/database/scripts/projection-health.mjs packages/database/scripts/
COPY packages/database/scripts/retention.mjs packages/database/scripts/
COPY packages/database/scripts/rotate-patient-keys.mjs packages/database/scripts/
COPY packages/database/scripts/verify-recovery.mjs packages/database/scripts/
COPY packages/database/scripts/verify-reporting-replica.mjs packages/database/scripts/
COPY packages/database/config/database-operations-policy.json packages/database/config/retention-policy.json packages/database/config/
COPY packages/database/generated packages/database/generated
COPY defines defines
RUN mkdir -p defines/catalog/local defines/forms/local defines/validation/local \
    && chown node:node defines/catalog/local defines/forms/local defines/validation/local
COPY supabase/migrations supabase/migrations

USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
