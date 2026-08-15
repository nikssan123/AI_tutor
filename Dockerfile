# syntax=docker/dockerfile:1
#
# Two images come out of this file:
#
#   --target runtime  → the Next.js standalone server (small, what serves traffic)
#   --target tools    → the full source tree + tsx (runs db:migrate and packs:seed)
#
# They are separate because `scripts/db-migrate.ts` and `scripts/packs-seed.ts`
# import from `src/`, which the standalone output does not contain. Baking tsx
# and the whole source tree into the serving image to run two one-shot commands
# would roughly triple it.

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── source ────────────────────────────────────────────────────────────────────
# Dependencies plus the tree, with nothing built yet. `tools` and `build` are
# siblings from here rather than a chain, and that ordering is load-bearing:
# `pnpm build` needs a migrated, seeded database, and the thing that migrates and
# seeds it is the tools image. Deriving tools from build would be a cycle.
FROM node:24-alpine AS source
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ── tools ─────────────────────────────────────────────────────────────────────
# One-shot image: migrations and pack seeding. Never serves a request, and never
# needs a built app — only src/, packs/ and tsx.
FROM source AS tools
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]

# ── build ─────────────────────────────────────────────────────────────────────
FROM source AS build

# Both of these must be present at BUILD time, not just at run time:
#
#   NEXT_PUBLIC_SITE_URL — `siteUrl()` in src/lib/site.ts feeds every canonical,
#     the sitemap and robots.txt. NEXT_PUBLIC_* is inlined into the client bundle
#     at build, so setting it only in the runtime environment leaves the built
#     output pointing at http://localhost:3000 — the exact failure the comment on
#     `siteUrl` warns about, and one that is invisible until traffic never arrives.
#
#   DATABASE_URL — `next build` prerenders src/app/sitemap.ts, which reads
#     authored SeoPage rows out of Postgres. This is the same reason ci.yml runs
#     db:migrate and packs:seed before pnpm build.
ARG NEXT_PUBLIC_SITE_URL
ARG DATABASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind all interfaces inside the container so Caddy can reach it over the
# compose network. This is not a host binding — nothing is published.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# `output: "standalone"` emits server.js plus only the node_modules actually
# reachable from it. static/ and public/ are not included and must be copied.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
