# syntax=docker/dockerfile:1.7
# Image of the Shield web app for hosting; scripts/deploy-web-aws.sh builds it and deploys it to AWS Lightsail.
# The build context is the repo root, where the pnpm workspace and lockfile live:
#
#   docker buildx build --platform linux/amd64 -f web/Dockerfile -t shield-web .
#
# NEXT_PUBLIC_* values are compiled into the pages, so they are build args. NEXT_PUBLIC_MONAD_RPC_URL and the E2E
# variables are deliberately not args: a hosted build always reads Monad's public RPC and never a local fork.
# The image runs Next's standalone server on port 3000 as the unprivileged node user.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Every workspace manifest, so the frozen lockfile matches; only web and its dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY keeper/package.json keeper/
COPY indexer/package.json indexer/
RUN --mount=type=cache,id=shield-pnpm-store,target=/root/.cache/pnpm-store \
    pnpm install --frozen-lockfile --filter web... --store-dir /root/.cache/pnpm-store

FROM deps AS build
COPY web/ web/
ARG NEXT_PUBLIC_SHIELD_REGISTRY=""
ARG NEXT_PUBLIC_SHIELD_REPRICER=""
ARG NEXT_PUBLIC_SHIELD_EXECUTOR=""
ARG NEXT_PUBLIC_SHIELD_VAULT=""
ARG NEXT_PUBLIC_SHIELD_FORWARDERS=""
ARG NEXT_PUBLIC_AURORA_APP_KEY=""
ARG NEXT_PUBLIC_ENVIO_GRAPHQL_URL=""
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=""
# Monad testnet staging builds only (ADR-040): the chain and the Aave V3 market Shield deployed there. Empty: mainnet.
ARG NEXT_PUBLIC_CHAIN_ID=""
ARG NEXT_PUBLIC_AAVE_POOL=""
ARG NEXT_PUBLIC_AAVE_ORACLE=""
ARG NEXT_PUBLIC_AAVE_DATA_PROVIDER=""
ARG NEXT_PUBLIC_AAVE_USDC=""
ARG NEXT_PUBLIC_AAVE_WETH=""
ENV NEXT_PUBLIC_SHIELD_REGISTRY=$NEXT_PUBLIC_SHIELD_REGISTRY \
    NEXT_PUBLIC_SHIELD_REPRICER=$NEXT_PUBLIC_SHIELD_REPRICER \
    NEXT_PUBLIC_SHIELD_EXECUTOR=$NEXT_PUBLIC_SHIELD_EXECUTOR \
    NEXT_PUBLIC_SHIELD_VAULT=$NEXT_PUBLIC_SHIELD_VAULT \
    NEXT_PUBLIC_SHIELD_FORWARDERS=$NEXT_PUBLIC_SHIELD_FORWARDERS \
    NEXT_PUBLIC_AURORA_APP_KEY=$NEXT_PUBLIC_AURORA_APP_KEY \
    NEXT_PUBLIC_ENVIO_GRAPHQL_URL=$NEXT_PUBLIC_ENVIO_GRAPHQL_URL \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_AAVE_POOL=$NEXT_PUBLIC_AAVE_POOL \
    NEXT_PUBLIC_AAVE_ORACLE=$NEXT_PUBLIC_AAVE_ORACLE \
    NEXT_PUBLIC_AAVE_DATA_PROVIDER=$NEXT_PUBLIC_AAVE_DATA_PROVIDER \
    NEXT_PUBLIC_AAVE_USDC=$NEXT_PUBLIC_AAVE_USDC \
    NEXT_PUBLIC_AAVE_WETH=$NEXT_PUBLIC_AAVE_WETH \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM node:${NODE_VERSION}-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone output mirrors the workspace: the server is web/server.js, traced dependencies sit beside it.
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=build --chown=node:node /app/web/public ./web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "web/server.js"]
