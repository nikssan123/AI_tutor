# First deploy, step by step

Getting MeritKeep live on the shared VPS without disturbing webwork.bg. Follow it
in order — the ordering is the safety. `README.md` in this directory explains why
each step is shaped the way it is; this file is just the walkthrough.

Replace `meritkeep.xyz` with the real domain throughout, and `<VPS_IP>` /
`<DEPLOY_USER>` with the host and account — kept out of this public repo and
stored as the `DEPLOY_HOST` / `DEPLOY_USER` secrets on the `production`
environment (`gh secret list --env production`).

---

## Before you start

- [ ] Domain bought, added to Cloudflare, zone reads **Active**
- [ ] Repo variable `NEXT_PUBLIC_SITE_URL` = `https://meritkeep.xyz`
- [ ] Environment `production` created with `DEPLOY_SSH_KEY`, `DEPLOY_HOST`,
      `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`
- [ ] SSH to the box works: `ssh <DEPLOY_USER>@<VPS_IP> true`

---

## 1. Add swap to the VPS

Once, before anything else. The host has 7.6GB and no swap.

```sh
ssh <DEPLOY_USER>@<VPS_IP> '
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile &&
  sudo mkswap /swapfile && sudo swapon /swapfile &&
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab &&
  free -h'
```

## 2. Build the images, without deploying

The first real end-to-end build. Nothing touches the server.

```sh
gh workflow run deploy.yml -f build_only=true
gh run watch
```

If it fails, it fails on a runner instead of mid-deploy. The most likely cause is
`pnpm build` not reaching Postgres when it prerenders the sitemap.

Then make both packages public at
`github.com/users/nikssan123/packages` → each package → Package settings →
Change visibility. Otherwise the VPS cannot pull them.

## 3. Set the stack up on the VPS

```sh
ssh <DEPLOY_USER>@<VPS_IP>
sudo mkdir -p /srv/meritkeep && sudo chown "$USER" /srv/meritkeep
git clone https://github.com/nikssan123/AI_tutor.git /srv/meritkeep
cd /srv/meritkeep
```

Write `.env.prod` (see `README.md` for the full list):

```sh
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
NEXT_PUBLIC_SITE_URL=https://meritkeep.xyz
```

## 4. Start it, and check it from inside the network

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

`migrate` should show `Exited (0)`; everything else `Up`.

Now prove the shared Caddy will be able to reach you — **without changing the
shared Caddy at all**:

```sh
docker run --rm --network web curlimages/curl -sI http://meritkeep-caddy/ | head -1
```

Expect `HTTP/1.1 200 OK`. If this fails, stop here and fix it. Nothing public has
changed yet and webwork.bg has not been touched.

## 5. Point DNS — grey cloud for now

In Cloudflare DNS for the MeritKeep zone:

```
A   @     <VPS_IP>    DNS only (grey)
A   www   <VPS_IP>    DNS only (grey)
```

Wait for it to resolve:

```sh
dig +short meritkeep.xyz
```

## 6. Add the route to site_maker's Caddy

In the **site_maker** repo, add to `caddy/Caddyfile` — above the `:80` and `:443`
blocks at the bottom, so it stays more specific than the catch-all:

```caddyfile
# ─── MeritKeep (separate project, same VPS) ─────────────────
# Runs its own Caddy on the shared `web` network and owns everything below TLS.
# Keep this a bare reverse_proxy — importing main_site or security_headers would
# apply two sets of headers to every response.
#
# Deleting this block does not just break MeritKeep: the domain falls through to
# the :443 on-demand handler below, which asks this backend whether it owns the
# domain, gets "no", and serves the domain-not-found page — to Googlebot too.
meritkeep.xyz, www.meritkeep.xyz {
	reverse_proxy meritkeep-caddy:80
}
```

Commit it to `master` (a local-only edit is erased by the next `deploy.sh prod`,
which runs `git reset --hard`), then:

```sh
./deploy.sh caddy
```

That validates the Caddyfile locally with `caddy adapt` before anything reaches
the server, then **reloads** rather than restarts. A config that will not parse
leaves the running one serving.

## 7. Verify — all three, not just yours

```sh
curl -sI https://meritkeep.xyz  | head -1
curl -sI https://webwork.bg     | head -1
curl -sI https://bot.webwork.bg | head -1
```

All three should be `200`. The certificate is issued on first request, so give
MeritKeep a few seconds.

## 8. Turn on the CDN

Only now, and only in Cloudflare — this touches the VPS not at all.

1. DNS: flip both records to **Proxied (orange)**
2. SSL/TLS → **Full (strict)**
3. SSL/TLS → Edge Certificates: Always Use HTTPS **on**, min TLS **1.2**,
   Automatic HTTPS Rewrites **on**, HSTS **off** (our Caddy sends it)
4. Security → Bots → Bot Fight Mode **off** — it can challenge Googlebot
5. Speed → Optimization → Rocket Loader **off** — it breaks React hydration

Then confirm the edge is in front and the canonical host is right:

```sh
curl -sI https://meritkeep.xyz | grep -iE 'cf-cache-status|strict-transport'
curl -s  https://meritkeep.xyz/robots.txt
curl -s  https://meritkeep.xyz/sitemap.xml | head -5
```

If robots or the sitemap mention `localhost:3000`, the image was built without
`NEXT_PUBLIC_SITE_URL`. Rebuild — it cannot be fixed with configuration.

## 9. From here on

```sh
gh workflow run deploy.yml -f ref=main
```

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| MeritKeep 404s or shows a "domain not found" page | The Caddyfile block is missing or below the catch-all. Re-check step 6. |
| `meritkeep-caddy` unreachable from the `web` network | Your caddy service is not attached to `web`, or the alias is wrong |
| `migrate` exits non-zero | `docker compose -f docker-compose.prod.yml logs migrate` — the app never starts on a half-migrated schema, which is deliberate |
| Certificate never issues | Check DNS resolves, and that step 6's block exists. Grey-cloud it while debugging. |
| **Anything at all on webwork.bg** | Remove the block from site_maker's Caddyfile and `./deploy.sh caddy`. That is a reload; it restores the previous routing without a restart. |

Everything here reverses: delete the Caddyfile block and reload, `docker compose
-f docker-compose.prod.yml down`, revert the DNS records, toggle back to grey.

**The one command not in this tutorial**, because it recreates the container
serving every webwork.bg customer domain and nothing here needs it:

```sh
docker compose -f docker-compose.caddy.yml up -d caddy   # ← schedule deliberately
```
