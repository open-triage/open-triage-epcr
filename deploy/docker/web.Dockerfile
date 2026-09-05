FROM node:22-bookworm-slim AS build

WORKDIR /workspace
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build -w @open-triage/contracts && npm run build -w @open-triage/api && npm run build -w @open-triage/web

FROM nginx:1.29-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/out /usr/share/nginx/html
EXPOSE 80
