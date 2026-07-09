# Build dependencies on the native builder arch to avoid running pnpm under QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM --platform=$TARGETPLATFORM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173
ENV PET_DATA_FILE=/data/pet-state.json
ENV STATIC_DIR=/app/dist

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server

RUN mkdir -p /data && chown node:node /data

VOLUME ["/data"]
EXPOSE 4173

USER node

CMD ["node", "server/index.mjs"]
