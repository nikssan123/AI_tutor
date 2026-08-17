#!/usr/bin/env bash
#
# MeritKeep — the commands you actually run, in one place.
#
#   ./deploy.sh help
#
# Shaped after site_maker's `deploy.sh`, which deploys the other stack on the
# same VPS: same `DEPLOY_SSH_HOST`, same validate-the-Caddyfile-before-you-SSH
# reflex, same `git reset --hard origin/<branch>` on the box, same reload rather
# than restart for Caddy. If you know that script, you know this one.
#
# ## The one place it deliberately differs
#
# site_maker runs `docker compose up -d --build` on the server. **This stack must
# not.** `next build` alongside two Postgres instances on a 7.6GB host is the OOM
# `deploy/README.md` is written to avoid, and the neighbour the kernel would pick
# is webwork.bg's production Postgres. So images are built in GitHub Actions and
# the server only ever pulls them. `./deploy.sh prod` does both halves in one
# command, which is what makes that split invisible in daily use.
#
# ## What is deliberately NOT in here
#
# The VPS address. This repo is public and that host fronts webwork.bg's customer
# domains, so the address comes from `DEPLOY_SSH_HOST` in your shell — the same
# variable site_maker uses, already exported from ~/.zshrc — and never from
# source.
#
set -euo pipefail

cd "$(dirname "$0")"

readonly COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
readonly REMOTE_DIR="/srv/meritkeep"
readonly DEV_PORT="${PORT:-3000}"
readonly LOCAL_DB="postgres://online_uni:online_uni@localhost:5433/online_uni"
readonly SITE="${NEXT_PUBLIC_SITE_URL:-https://meritkeep.com}"

# ── output ───────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  readonly DIM=$'\033[2m' BOLD=$'\033[1m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' OFF=$'\033[0m'
else
  readonly DIM='' BOLD='' RED='' GREEN='' YELLOW='' OFF=''
fi

step() { printf '%s→ %s%s\n' "$BOLD" "$*" "$OFF"; }
note() { printf '%s  %s%s\n' "$DIM" "$*" "$OFF"; }
warn() { printf '%s!  %s%s\n' "$YELLOW" "$*" "$OFF" >&2; }
ok()   { printf '%s✔ %s%s\n' "$GREEN" "$*" "$OFF"; }
die()  { printf '%s✘ %s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

# Anything that changes production asks first. `-y` and a non-interactive shell
# skip it, so this guards against the slip rather than against intent.
confirm() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  [ -t 0 ] || die "Refusing to $1 without a terminal to confirm at. Pass -y if you mean it."
  printf '%s%s?%s [y/N] ' "$BOLD" "$1" "$OFF"
  read -r reply
  case "$reply" in [yY]*) return 0 ;; *) die "Cancelled." ;; esac
}

# ── the SSH target, which never lives in this repo ────────────────────────────

ssh_host() {
  # `DEPLOY_SSH_HOST=user@host`, exactly as site_maker wants it — one VPS, one
  # variable, already exported from ~/.zshrc. The split pair is accepted too so
  # this works in CI, where the two halves arrive as separate secrets.
  if [ -z "${DEPLOY_SSH_HOST:-}" ] && [ -n "${DEPLOY_HOST:-}" ] && [ -n "${DEPLOY_USER:-}" ]; then
    DEPLOY_SSH_HOST="$DEPLOY_USER@$DEPLOY_HOST"
  fi
  : "${DEPLOY_SSH_HOST:?set DEPLOY_SSH_HOST=user@host — same value site_maker uses, kept out of this public repo}"
  printf '%s' "$DEPLOY_SSH_HOST"
}

# Runs a script on the VPS.
#
# Spooled to a file rather than `ssh host bash -s`. With `bash -s` the script
# *is* stdin, so the first command that reads stdin swallows the rest of it and
# the run ends early while reporting success. site_maker hit this and works
# around it by appending `</dev/null` to every offending command — which works
# until somebody adds a command and forgets. Spooling removes the class of bug
# instead of patching each instance, and is what .github/workflows/deploy.yml
# already does.
remote() {
  ssh -o BatchMode=yes "$(ssh_host)" \
    'T=$(mktemp /tmp/mk-run.XXXXXX) && cat >"$T" && bash "$T"; rc=$?; rm -f "$T"; exit $rc'
}

# ── local development ────────────────────────────────────────────────────────

cmd_db() {
  need docker "https://docs.docker.com/get-docker/"
  step "Starting Postgres"
  # Bare `up -d` on purpose: the app and Inngest sit behind a compose profile, so
  # this keeps meaning "start the database the tests need".
  docker compose up -d
  ok "Postgres up on :5433"
}

# Next writes no pidfile and `pkill -f "next dev"` misses the workers it forks,
# so the port is the honest handle.
stop_dev() {
  local pids
  pids="$(lsof -ti "tcp:$DEV_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  note "Stopping what is on :$DEV_PORT"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 10); do
    lsof -ti "tcp:$DEV_PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.3
  done
  warn "Still holding :$DEV_PORT — SIGKILL"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}

cmd_dev() {
  need pnpm "corepack enable"
  cmd_db
  stop_dev
  step "Dev server on :$DEV_PORT"
  # A restart is the only way to pick up a changed .env.local: NEXT_PUBLIC_* is
  # inlined into the client bundle at compile time.
  note "Reads .env.local at startup — restart after editing it"
  exec pnpm dev
}

cmd_stop()    { stop_dev; ok "Dev server stopped. Postgres still up — ./deploy.sh db-stop for that."; }
cmd_db_stop() { docker compose down; ok "Postgres stopped"; }

# The gate AGENTS.md requires before every commit. A subcommand for one reason:
# vitest does not read .env.local, so a bare `pnpm verify` silently skips every
# database-backed test and reports ~96.5% coverage — a misconfigured run that
# reads exactly like a regression.
cmd_verify() {
  need pnpm "corepack enable"
  cmd_db
  step "typecheck → lint → tokens → audits → packs → coverage"
  DATABASE_URL="${DATABASE_URL:-$LOCAL_DB}" pnpm verify
}

# ── pre-flight ───────────────────────────────────────────────────────────────

# The server does `git reset --hard origin/<branch>` and the images are built
# from a ref on GitHub. Neither can see a commit you have not pushed, and the
# failure mode is a deploy that reports success having shipped last week's code.
check_pushed() {
  local branch="$1"
  git fetch --quiet --prune origin 2>/dev/null || warn "Could not reach origin; the checks below may be stale."

  git rev-parse --verify --quiet "origin/$branch" >/dev/null 2>&1 ||
    die "origin has no branch '$branch'."

  local ahead
  ahead="$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo 0)"
  [ "$ahead" != "0" ] && warn "$ahead local commit(s) are not on origin/$branch and will NOT be deployed."
  git diff --quiet HEAD 2>/dev/null || warn "Working tree is dirty. Uncommitted changes are never deployed."
  return 0
}

# Catches a typo before it reaches the server. `adapt` rather than `validate`:
# validate provisions the TLS module, which wants real credentials.
validate_caddyfile() {
  need docker "https://docs.docker.com/get-docker/"
  step "Validating deploy/caddy/Caddyfile locally"
  docker build -q -t meritkeep-caddy:validate deploy/caddy >/dev/null
  docker run --rm -v "$PWD/deploy/caddy:/etc/caddy:ro" meritkeep-caddy:validate \
    caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  ok "Caddyfile parses"
}

# ── the real deploy ──────────────────────────────────────────────────────────

# Build in Actions, deploy from here.
#
# The images have to be built somewhere that is not the VPS, and GitHub Actions
# is where the Dockerfile's build-time requirements already live: a Postgres for
# the sitemap prerender, NEXT_PUBLIC_SITE_URL baked in, and the check that no
# localhost URL survived into the bundle. `build_only=true` stops the workflow
# before its own SSH step, so exactly one thing deploys and it is this script.
build_images() {
  local ref="$1"
  need gh "https://cli.github.com — then: gh auth login"
  step "Building images for '$ref' in GitHub Actions"
  note "Not on the VPS: 7.6GB shared with webwork.bg's Postgres"
  gh workflow run deploy.yml -f ref="$ref" -f build_only=true
  sleep 4
  local id
  id="$(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
  gh run watch "$id" --exit-status || die "The build failed. Nothing was deployed."
  ok "Images pushed to GHCR"
}

cmd_prod() {
  local branch="${BRANCH:-main}" skip_build=0 service=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pull) skip_build=1 ;;
      --*) die "Unknown flag: $1" ;;
      *) service="$1" ;;
    esac
    shift
  done

  check_pushed "$branch"
  validate_caddyfile
  confirm "Deploy origin/$branch to production"

  [ "$skip_build" = "0" ] && build_images "$branch"

  step "Deploying to $(ssh_host):$REMOTE_DIR"
  remote <<EOF
set -euo pipefail
cd "$REMOTE_DIR"

[ -f .env.prod ] || { echo "✘ $REMOTE_DIR/.env.prod is missing"; exit 1; }

# The compose file and the Caddyfile are read from this checkout, so it has to
# move before the images do.
git fetch --prune origin
git checkout "$branch"
git reset --hard "origin/$branch"

$COMPOSE pull $service
# migrate runs to completion and web gates on its clean exit, so a failed
# migration stops here rather than starting a server on a half-built schema.
$COMPOSE up -d --remove-orphans $service

echo
$COMPOSE ps

# Caddy reads its config from the bind-mounted directory. Reload is atomic: a
# config that will not parse leaves the running one serving.
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null
EOF

  ok "Deployed origin/$branch"
  cmd_health
}

# Reload-only. For a Caddyfile change with no app redeploy behind it.
cmd_caddy() {
  local branch="${BRANCH:-main}"
  check_pushed "$branch"
  validate_caddyfile
  warn "The VPS reads its Caddyfile from its own checkout. Push first, or the"
  warn "reload re-reads the old file and reports success."
  confirm "Reload production Caddy"
  remote <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
git fetch --prune origin
git reset --hard "origin/$branch"
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null
EOF
  ok "Reloaded"
}

# ── the server ───────────────────────────────────────────────────────────────

cmd_ps() {
  remote <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
$COMPOSE ps
EOF
}

cmd_logs() {
  local service="${1:-web}" lines="${2:-200}"
  step "'$service', last $lines lines (Ctrl-C to stop)"
  remote <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
$COMPOSE logs --tail "$lines" -f "$service"
EOF
}

# Restarts containers from the images already on the box. NOT a deploy: nothing
# is pulled and no new code arrives. For a wedged process or an .env.prod edit.
cmd_restart() {
  local service="${1:-}"
  [ "$service" = "caddy" ] && die "Do not restart caddy — use './deploy.sh caddy'.
A restart with a broken config leaves nothing serving; a reload is atomic."
  confirm "Restart ${service:-every service} in production"
  remote <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
$COMPOSE restart $service
$COMPOSE ps
EOF
  ok "Restarted"
}

cmd_shell() {
  step "Shell in $REMOTE_DIR"
  exec ssh -t "$(ssh_host)" "cd $REMOTE_DIR && exec \$SHELL -l"
}

# ── after a deploy ───────────────────────────────────────────────────────────

cmd_health() {
  step "Checking $SITE"
  curl -sS -o /dev/null -w '  /            %{http_code}  %{time_total}s\n' "$SITE" || true
  curl -sS -o /dev/null -w '  /robots.txt  %{http_code}\n' "$SITE/robots.txt" || true
  curl -sS -o /dev/null -w '  /sitemap.xml %{http_code}\n' "$SITE/sitemap.xml" || true

  # The one failure that stays invisible until the search traffic never arrives.
  if curl -sS "$SITE/sitemap.xml" 2>/dev/null | grep -q 'localhost:3000'; then
    die "The sitemap contains localhost URLs — the image was built without
NEXT_PUBLIC_SITE_URL. That needs rebuilding, not reconfiguring."
  fi
  ok "Sitemap carries real URLs"
}

# Bing, Yandex, Seznam and Naver. Google has never joined IndexNow and still
# finds pages by crawling the sitemap, so a green line here is not a Google
# signal — deploy/README.md has the detail.
cmd_indexnow() { need pnpm "corepack enable"; pnpm indexnow "$@"; }

cmd_runs() { need gh "https://cli.github.com"; gh run list --workflow=deploy.yml --limit 10; }

# ── dispatch ─────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
${BOLD}MeritKeep${OFF}  —  ./deploy.sh <command>

${BOLD}Deploy${OFF}
  prod [service]         Build in Actions, then pull + restart on the VPS
  prod --pull            Skip the build; deploy the images already in GHCR
  caddy                  Validate the Caddyfile locally, then reload production
  runs                   Recent GitHub Actions build runs

  ${DIM}BRANCH=x ./deploy.sh prod   deploy a branch other than main${OFF}

${BOLD}Server${OFF}
  ps                     Container status
  logs [svc] [n]         Follow logs. Default: web, 200
  restart [svc]          Restart from the images already there — not a deploy
  shell                  SSH into $REMOTE_DIR
  health                 Is the site answering, with the right URLs
  indexnow [--dry]       Submit the sitemap to Bing/Yandex/Seznam/Naver

${BOLD}Local${OFF}
  dev                    Restart Postgres + the dev server on :$DEV_PORT
  stop                   Stop the dev server
  db / db-stop           Postgres only
  verify                 Full pre-commit gate, with DATABASE_URL set correctly

${DIM}Needs DEPLOY_SSH_HOST=user@host — the same one site_maker uses, already in
your ~/.zshrc. -y skips confirmations. deploy/README.md is the reference.${OFF}
EOF
}

main() {
  local args=()
  for a in "$@"; do
    case "$a" in
      -y|--yes) ASSUME_YES=1 ;;
      *) args+=("$a") ;;
    esac
  done
  set -- "${args[@]+"${args[@]}"}"

  case "${1:-help}" in
    prod|deploy) shift; cmd_prod "$@" ;;
    caddy)     shift; cmd_caddy "$@" ;;
    runs)      shift; cmd_runs "$@" ;;
    ps)        shift; cmd_ps "$@" ;;
    logs)      shift; cmd_logs "$@" ;;
    restart)   shift; cmd_restart "$@" ;;
    shell|ssh) shift; cmd_shell "$@" ;;
    health)    shift; cmd_health "$@" ;;
    indexnow)  shift; cmd_indexnow "$@" ;;
    dev)       shift; cmd_dev "$@" ;;
    stop)      shift; cmd_stop "$@" ;;
    db)        shift; cmd_db "$@" ;;
    db-stop)   shift; cmd_db_stop "$@" ;;
    help|-h|--help) usage ;;
    *) printf '%sUnknown command: %s%s\n\n' "$RED" "$1" "$OFF" >&2; usage >&2; exit 1 ;;
  esac
}

main "$@"
