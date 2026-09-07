FROM node:22-bookworm-slim

WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci

COPY apps/api apps/api
COPY apps/web/app/data apps/web/app/data
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY supabase supabase
RUN npm run build -w @open-triage/contracts && npm run build -w @open-triage/api

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@open-triage/api"]
