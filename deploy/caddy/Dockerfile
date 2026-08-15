# Caddy with the rate-limit module compiled in. The stock image has no way to
# rate limit, and /api/auth/* needs one.
#
# Deliberately NOT built with caddy-dns/cloudflare: that plugin exists to solve
# DNS-01 challenges for wildcard certificates, and this Caddy never requests a
# certificate at all — the shared Caddy on this host terminates TLS and forwards
# plain HTTP to us. Add it only if MeritKeep ever needs *.meritkeep.xyz and takes
# over its own TLS.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# The Caddyfile is bind-mounted as a DIRECTORY by docker-compose.prod.yml, not
# baked in, so `caddy reload` picks up edits without an image rebuild. Mounting
# the directory rather than the file is not a style choice — see the comment in
# the compose file.
EXPOSE 80
