# Deploying MeritKeep

> **Doing this for the first time?** Follow [`TUTORIAL.md`](./TUTORIAL.md) — the
> ordered walkthrough. This file is the reference behind it: what each piece is
> for, and why it is shaped the way it is.

Runs on a shared Hetzner VPS (`<VPS_IP>`, kept out of this public repo — see
below), alongside the site_maker and trading-bot stacks. MeritKeep brings its own Caddy; the shared Caddy that owns
`:443` on that host forwards to it and does nothing else.

```
internet ──▶ shared Caddy (:443, site_maker's stack)   terminates TLS
                    │  reverse_proxy meritkeep-caddy:80
                    ▼
             meritkeep-caddy       ← our Caddyfile: routing, headers, rate limits
                    │
                    ▼
             web (Next.js :3000) ──▶ postgres      both on meritkeep-net only
```

Only `meritkeep-caddy` joins the shared `web` network. The app and the database
are on `meritkeep-net` and are unreachable from the other projects on the host.

## Bringing this up without disturbing webwork.bg

webwork.bg is live and has paying customers. Everything below is ordered so that
the only change touching its stack is a `caddy reload`, which is atomic and
reversible, and so that MeritKeep is proven working before it happens.

**What this deployment does NOT do:** publish any host port (the shared Caddy
keeps `:80`/`:443` to itself), create or modify the `web` network (declared
`external`, so compose only attaches to it), or run under a colliding compose
project name — the host has `project-maker`, `dev` and `trading-bot`; this is
`meritkeep`, so `--remove-orphans` can never reach their containers.

**Why an OOM here cannot kill their Postgres.** Every service in
`docker-compose.prod.yml` carries a `mem_limit`, totalling 2.25GB against 5.2GB
available. A container that exceeds its limit is killed inside its own cgroup, so
the kernel never goes looking system-wide for a victim — and
`project-maker-postgres-1`, up two months with a large resident set, is exactly
the process a system-wide OOM would choose. The limits are the protection; the
swapfile below is belt and braces. This is also why images are built in CI:
`docker build` on the host would run with no limit at all.

### Order

1. **Add swap** (see below). Do this first; it is the cheapest insurance.
2. **Deploy the MeritKeep stack.** Nothing public changes — no port is bound and
   no existing container is touched. Verify from the host itself:
   ```sh
   docker compose -f docker-compose.prod.yml --env-file .env.prod ps
   docker run --rm --network web curlimages/curl -sI http://meritkeep-caddy/ | head -1
   ```
   That last command proves the shared Caddy will be able to reach us, without
   changing the shared Caddy at all.
3. **Point DNS, grey cloud (DNS-only) for now.** Requests will briefly land in
   site_maker's `:443` on-demand catch-all and be refused — harmless, and nobody
   knows the domain yet.
4. **Add the Caddyfile block and reload.** From the site_maker repo, use
   `./deploy.sh caddy`: it builds their Caddy image and runs `caddy adapt`
   against the new config *locally* before any reload reaches the server, then
   reloads rather than restarts. A parse or provision failure leaves the running
   config serving.
5. **Verify MeritKeep over HTTPS**, and verify webwork.bg is untouched:
   ```sh
   curl -sI https://meritkeep.xyz | head -1
   curl -sI https://webwork.bg | head -1
   curl -sI https://bot.webwork.bg | head -1
   ```
6. **Only then flip Cloudflare to orange.** That is a Cloudflare-side change and
   touches the VPS not at all.

### Rollback

Nothing above is one-way.

| Step | Undo |
|---|---|
| Caddyfile block | Delete it, `./deploy.sh caddy` again. Reload, not restart. |
| MeritKeep stack | `docker compose -f docker-compose.prod.yml down` |
| DNS | Revert the records; TTL is Auto (~5 min) |
| Orange cloud | Toggle back to grey |

The one operation to schedule deliberately rather than perform casually is
`docker compose -f docker-compose.caddy.yml up -d caddy` in site_maker — that
*recreates* the container fronting every customer domain. Nothing in this
document requires it.

## One-time setup

### 1. The block in site_maker's Caddyfile

Add to `site_maker/caddy/Caddyfile` and commit it to that repo's `master`.
Committing matters: `site_maker/deploy.sh prod` runs `git reset --hard
origin/master` on its checkout, so a local-only edit would be erased on its next
deploy.

```caddyfile
# ─── MeritKeep (separate project, same VPS) ─────────────────
# Runs its own Caddy at meritkeep-caddy:80 on the shared `web` network and owns
# everything below TLS: routing, headers, compression, rate limits. This block
# must stay a bare reverse_proxy — importing main_site or security_headers here
# would apply two sets of headers to every response.
#
# It is also what keeps meritkeep.xyz out of the `:443` on-demand-TLS catch-all
# at the bottom of this file. Delete this block and requests fall through to
# that handler, which asks site_maker's backend whether it owns the domain,
# gets "no", and serves the domain-not-found page — to Googlebot included.
#
# No `tls` directive on purpose. Cloudflare passes /.well-known/acme-challenge/
# through to the origin and exempts it from Always Use HTTPS, so HTTP-01 issues
# and renews normally even with the zone proxied. TLS-ALPN cannot work behind the
# proxy, but Caddy falls back on its own.
meritkeep.xyz, www.meritkeep.xyz {
	reverse_proxy meritkeep-caddy:80
}
```

**This block is reloadable, and that is the point.** `caddy reload` re-reads the
config in place: no container restart, no dropped connections, and a config that
fails to parse or provision leaves the running one untouched. Every webwork.bg
customer stays served throughout.

DNS-01 would be marginally more robust, but it needs `MERITKEEP_CF_TOKEN` in the
caddy service's `environment:`, and an environment change requires `docker
compose up -d caddy` — a *recreate* of the container that has been serving
webwork.bg and every customer domain for weeks. That trade is not worth taking
pre-emptively. If a renewal ever fails, Caddy logs it roughly 30 days before the
certificate expires, which is ample time to schedule the switch deliberately:

```caddyfile
	tls {
		dns cloudflare {env.MERITKEEP_CF_TOKEN}
	}
```

with a token scoped to the MeritKeep zone only — never by widening the existing
`CF_API_TOKEN`, which would hand it webwork.bg's DNS as well.

Deploy it with `./deploy.sh caddy` from the site_maker repo, which validates the
Caddyfile locally before it reloads anything on the server.

### 2. Cloudflare

MeritKeep is its own Cloudflare zone, so nothing here touches webwork.bg's
settings — including the proxy decision, which is the opposite one.

**Why orange, when webwork.bg is grey.** Proxied, Cloudflare serves static
assets from a PoP near the visitor instead of from one box in Germany. Core Web
Vitals is a ranking signal, LCP is measured from real users via CrUX, and organic
search is this product's entire acquisition strategy. It also keeps the origin IP
out of public DNS — an IP shared with a host of arbitrary customer-built sites.

#### Zone

1. Buy the domain, add the site to Cloudflare, take the Free plan.
2. Set the two nameservers Cloudflare assigns at the registrar. They are
   per-zone and will differ from webwork.bg's.
3. Wait for the zone to read **Active** before going further.

#### DNS

```
Type   Name   Content           Proxy      TTL
A      @      <VPS_IP>    Proxied    Auto
A      www    <VPS_IP>    Proxied    Auto
```

No AAAA record: the VPS has no global IPv6, only link-local.

#### SSL/TLS

| Setting | Value | Why |
|---|---|---|
| Encryption mode | **Full (strict)** | Flexible speaks HTTP to the origin, and the shared Caddy redirects `:80` → HTTPS. That is an infinite redirect loop. Plain Full accepts any origin cert including expired ones; you have a real Let's Encrypt cert, so strict costs nothing. |
| Always Use HTTPS | On | |
| Minimum TLS Version | 1.2 | |
| TLS 1.3 | On | |
| Automatic HTTPS Rewrites | On | |
| HSTS | **Off** | The MeritKeep Caddyfile already sends it with `preload`. Two sources for one header is a good way to end up unable to turn it off — an HSTS max-age you did not intend is not retractable from the browser side. |

No Cloudflare API token is needed. The certificate comes from HTTP-01, which
works through the proxy — see the Caddyfile block above for why that choice is
deliberate rather than lazy.

#### Caching and optimization

Cloudflare's defaults are already right for a Next.js app. Two things to
actively avoid:

- **Do not enable "Cache Everything."** Pages are server-rendered and
  session-dependent; caching HTML at the edge would serve one signed-in user's
  shell to the next visitor. The default rules cache static extensions and leave
  HTML alone, which is what you want. `/_next/static/*` is content-hashed and
  already carries `immutable` from our Caddy, and Cloudflare honours origin
  `Cache-Control`.
- **Leave Rocket Loader off** (Speed → Optimization). It defers and reorders
  scripts, which breaks React hydration and moves layout after first paint —
  directly against the CLS number the orange cloud is here to improve.

#### Bot Fight Mode — leave it off

Security → Bots → **Bot Fight Mode: Off**. The free tier's version has no
verified-bot allowlist and can issue JS challenges to legitimate crawlers,
Googlebot included. A crawler that gets a challenge instead of HTML sees an empty
page. This is the single most damaging switch in the Cloudflare dashboard for a
site that lives on organic search.

#### Order of operations

Deploy the stack and point DNS **grey (DNS-only) first**, confirm HTTPS and the
certificate, then flip both records to orange. With DNS-01 the certificate works
either way, but changing one variable at a time means a failure tells you whether
it is the origin or the edge.

#### After going orange, verify

```sh
curl -sI https://meritkeep.xyz | grep -iE 'cf-cache-status|strict-transport|server'
curl -s https://meritkeep.xyz/robots.txt
curl -s https://meritkeep.xyz/sitemap.xml | head -20
```

The sitemap and robots must show the real origin, not `localhost:3000` — if they
do not, the image was built without `NEXT_PUBLIC_SITE_URL` and needs rebuilding,
not reconfiguring. Then add the property in Google Search Console and submit the
sitemap.

### 3. On the VPS

```sh
sudo mkdir -p /srv/meritkeep && sudo chown "$USER" /srv/meritkeep
git clone https://github.com/nikssan123/AI_tutor.git /srv/meritkeep
cd /srv/meritkeep
```

Write `/srv/meritkeep/.env.prod` — never committed, never built into an image:

```sh
POSTGRES_PASSWORD=<generate>
BETTER_AUTH_SECRET=<32+ chars>
NEXT_PUBLIC_SITE_URL=https://meritkeep.xyz
ANTHROPIC_API_KEY=
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Billing. Blank is fine until you are selling; ../STRIPE-SETUP.md §5 is the
# live-mode switch, and it is these two lines plus a dashboard webhook.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Google sign-in is off until both `GOOGLE_*` halves are set; with one or neither,
the button is not rendered. The authorised redirect URI to register with Google
is `https://meritkeep.xyz/api/auth/callback/google` — it must match the
`NEXT_PUBLIC_SITE_URL` origin above exactly, scheme and all.

The host has **no swap** and 7.6GB shared with another project. Add some before
the first deploy, or an OOM will pick a victim from a neighbouring stack:

```sh
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Deploying

### From GitHub Actions

`.github/workflows/deploy.yml` builds both images, pushes them to GHCR, and
restarts the stack over SSH. **It has no push trigger** — it runs only from
"Run workflow" in the Actions tab, or:

```sh
gh workflow run deploy.yml -f ref=main
gh workflow run deploy.yml -f build_only=true   # push images, leave the server alone
```

Repository **variable**:

| | |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://meritkeep.xyz` — a variable, not a secret; it ships in the client bundle either way |

Environment **secrets**, on an environment named `production`:

| | |
|---|---|
| `DEPLOY_SSH_KEY` | Private half of a deploy-only keypair |
| `DEPLOY_HOST` | The VPS address |
| `DEPLOY_USER` | The deploy account on it |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <VPS_IP>` |

`<VPS_IP>` and `<DEPLOY_USER>` stand in for the real values throughout this
directory. This repo is public and the host also fronts webwork.bg's customer
domains, so the address stays in the `production` environment secrets above and
out of the source — the same reasoning as the orange cloud keeping it out of
public DNS. Read them back with `gh secret list --env production`.

Adding a required reviewer to the `production` environment makes every run pause
for approval before it touches the server. Secrets are never exposed to pull
requests from forks, which is what makes this safe on a public repo.

GHCR packages are created private even when the repo is public. Either set both
packages to public after the first push, or give the VPS a read-only PAT and
`docker login ghcr.io`. Public is reasonable here — the source is already public
and `.dockerignore` keeps every `.env*` out of the image — but it is a deliberate
choice, not a default to accept without noticing.

### By hand

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

`migrate` runs to completion first and `web` waits for its clean exit, so a
failed migration stops the deploy instead of starting a server against a
half-migrated schema.

**Do not build on the VPS.** `next build` alongside two Postgres instances on
7.6GB is the OOM this setup is shaped to avoid. Images are built in GitHub
Actions and pulled from GHCR.

### Build arguments that must be right

`NEXT_PUBLIC_SITE_URL` is baked in at build time, not just supplied at runtime.
`siteUrl()` in `src/lib/site.ts` feeds every canonical, the sitemap and
robots.txt, and `NEXT_PUBLIC_*` is inlined into the client bundle during
`next build`. An image built without it emits `http://localhost:3000` canonicals
and a localhost sitemap — invisible until the traffic never arrives.

`DATABASE_URL` is also needed at build time, because `next build` prerenders
`src/app/sitemap.ts`, which reads authored `SeoPage` rows out of Postgres. This
is the same reason `ci.yml` runs `db:migrate` and `packs:seed` before
`pnpm build`.

## Changing the Caddy config

`deploy/caddy` is bind-mounted, so a config change needs a reload, not a rebuild:

```sh
docker compose -f docker-compose.prod.yml exec -T caddy \
    caddy reload --config /etc/caddy/Caddyfile </dev/null
```

Validate locally first — the same check site_maker's `deploy.sh` runs:

```sh
docker build -q -t meritkeep-caddy:validate deploy/caddy
docker run --rm -v "$PWD/deploy/caddy:/etc/caddy:ro" meritkeep-caddy:validate \
    caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile
```

Reload is atomic: a config that fails to parse leaves the running one in place.
A *restart* with a broken config is a different story, so validate first.

## What is shared with the other projects, and what is not

| | Shared | Ours alone |
|---|---|---|
| Host, kernel, CPU, RAM | ✓ | |
| Public IP and `:443` | ✓ | |
| TLS termination and certificates | ✓ | |
| Caddy config, routing, rate limits | | ✓ |
| Docker network for app + database | | ✓ |
| Postgres, volumes, secrets | | ✓ |
| Deploy cycle and image registry | | ✓ |

The remaining coupling is uptime: if the shared Caddy fails to *start* after a
bad config change, MeritKeep goes down with it. The exit is a second Hetzner
server (~€4.49/mo, cheaper per month than the €3.60 floating IP that would only
buy a second address on this one), at which point this stack moves unchanged —
it only needs its `caddy` service to bind `:80`/`:443` and terminate TLS itself.
