FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212 AS build

WORKDIR /workspace
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION=false
ARG OPEN_TRIAGE_BUILD_SHA=local
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION=${NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION}
ENV OPEN_TRIAGE_BUILD_SHA=${OPEN_TRIAGE_BUILD_SHA}
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
COPY defines defines
COPY packages/contracts packages/contracts
COPY packages/database/config/identifying-elements.json packages/database/config/identifying-elements.json
COPY deploy/docker/nginx.conf deploy/docker/nginx.conf
COPY deploy/docker/generate-nginx-config.mjs deploy/docker/generate-nginx-config.mjs
RUN npm run build -w @open-triage/contracts && npm run build -w @open-triage/api && npm run build -w @open-triage/web
RUN node deploy/docker/generate-nginx-config.mjs deploy/docker/nginx.conf apps/web/out /tmp/nginx.conf

FROM nginx:1.31.0-alpine@sha256:2f07d83bf561b506400dc183b1b2003803e39efbd22451f848adaba14d28c7c7
COPY --from=build /tmp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/out /usr/share/nginx/html
EXPOSE 80
