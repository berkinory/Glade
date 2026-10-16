FROM oven/bun:1.4.2-slim AS base

FROM base AS pruner
WORKDIR /app

COPY . .

RUN bunx turbo@2.10.5 prune @glade/landing --docker

FROM base AS installer
WORKDIR /app

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock
# The root package.json lists patched dependencies; Bun needs the patch files even when the pruned
# graph does not install the packages they patch.
COPY --from=pruner /app/patches ./patches

# Only the site's runtime dependencies: the root's development tooling and its postinstall patches
# have no place in this image.
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY --from=pruner /app/out/full/ .
# Workspace tsconfigs extend the root base, which pruning does not carry.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

FROM installer AS builder
WORKDIR /app

RUN bun run --cwd apps/landing build

FROM base AS runner
WORKDIR /app

# Installed at build time and pinned: this site publishes Glade's OAuth client identity, so what
# serves it must not change or download anything when the container starts.
RUN bun add serve@14.2.6

COPY --from=builder --chown=bun:bun /app/apps/landing/dist ./dist

USER bun

EXPOSE 4001

ENV NODE_ENV=production
ENV NO_UPDATE_CHECK=1

CMD ["bunx", "--bun", "serve", "./dist", "--listen", "4001", "--no-clipboard"]
