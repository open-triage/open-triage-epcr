FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build

WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY defines defines
COPY supabase/migrations supabase/migrations
COPY deploy/docker/api-runtime-manifest.json deploy/docker/api-runtime-manifest.json
COPY deploy/docker/generate-api-runtime.mjs deploy/docker/generate-api-runtime.mjs
COPY deploy/docker/validate-api-runtime.mjs deploy/docker/validate-api-runtime.mjs
RUN npm run build -w @open-triage/contracts \
    && npm run build -w @open-triage/api \
    && node deploy/docker/generate-api-runtime.mjs deploy/docker/api-runtime-manifest.json /api-runtime

FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime

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

# One manifest-generated artifact contains the application, every declared
# operational entrypoint, its local import closure, and required runtime assets.
COPY --from=build /api-runtime/ ./

USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
