# Backend image (server/). Build context is the REPO ROOT, because the server imports the workspace
# packages (packages/shared, packages/program-client) and the program's IDL (anchor/idl).
#
#   docker build -t solana-wallet-backend .
#   fly deploy            (uses fly.toml in this folder)

FROM oven/bun:1-slim AS deps
WORKDIR /app

# 1) Only the package manifests first, so the dependency layer is cached until they change.
#    Every workspace listed in the root package.json needs its manifest present for the lockfile to resolve.
COPY package.json bun.lock ./
COPY web/package.json web/
COPY scripts/package.json scripts/
COPY server/package.json server/
COPY packages/shared/package.json packages/shared/
COPY packages/program-client/package.json packages/program-client/

# 2) Install only what the server and the two workspace packages it imports need (not React, Vite, Tailwind ...).
#    Each package has to be named: a filter does not pull in the dependencies of its workspace dependencies.
RUN bun install --frozen-lockfile --production --filter '@wallet/server' --filter '@wallet/shared' --filter '@wallet/program-client'


FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production

# installed dependencies (root and per-package node_modules)
COPY --from=deps /app ./

# 3) The code the server runs: its own source, the two workspace packages, and the IDL they read.
COPY package.json ./
COPY server ./server
COPY packages ./packages
COPY anchor/idl ./anchor/idl

# Persistent data (database, NFT pictures) lives on a mounted volume, see fly.toml.
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun

EXPOSE 8080
WORKDIR /app/server
CMD ["bun", "run", "src/index.ts"]
