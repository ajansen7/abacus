#!/usr/bin/env bash
# prod-up.sh — run the stack with production-built assets for maximum responsiveness.
#
# The dev-up.sh script uses tsx watch + Next.js dev mode, which is convenient for
# code changes but noticeably slower. This script builds everything first and then
# runs the compiled artifacts.
#
# Starts (in this order):
#   1. Build the platform (tsc)
#   2. Build the marathon dashboard (next build)
#   3. Start the platform (node dist/main.js on :3001, ABACUS_RUNNER=claude)
#   4. Start the dashboard (next start on :3000)
#   5. Optionally: cloudflared quick tunnel + Strava webhook subscription
#
# On SIGINT / SIGTERM / EXIT: kills all child processes and cleans up the Strava
# subscription if one was created.
#
# Flags:
#   --no-tunnel      skip cloudflared + Strava subscription
#   --no-dashboard   skip building and starting the marathon dashboard
#   --skip-build     skip the build step (use existing build artifacts)
#
# Logs:
#   runtime/prod-logs/{platform,dashboard,cloudflared}.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

WITH_TUNNEL=1
WITH_DASHBOARD=1
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) WITH_TUNNEL=0 ;;
    --no-dashboard) WITH_DASHBOARD=0 ;;
    --skip-build) SKIP_BUILD=0; SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "[prod-up] unknown flag: $arg" >&2; exit 2 ;;
  esac
done

LOG_DIR="$REPO_ROOT/runtime/prod-logs"
mkdir -p "$LOG_DIR"

PLATFORM_PID=""
DASHBOARD_PID=""
TUNNEL_PID=""
TUNNEL_URL=""
SUBSCRIPTION_ID=""

log() { echo "[prod-up] $*"; }
err() { echo "[prod-up] $*" >&2; }

kill_tree() {
  local pid="$1" sig="${2:-TERM}"
  [ -z "$pid" ] && return 0
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    kill_tree "$c" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  log "shutting down…"
  if [[ -n "$SUBSCRIPTION_ID" ]]; then
    log "removing Strava subscription $SUBSCRIPTION_ID"
    pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
      --delete "$SUBSCRIPTION_ID" 2>/dev/null || true
  fi
  [[ -n "$TUNNEL_PID" ]]    && kill_tree "$TUNNEL_PID"
  [[ -n "$DASHBOARD_PID" ]] && kill_tree "$DASHBOARD_PID"
  [[ -n "$PLATFORM_PID" ]]  && kill_tree "$PLATFORM_PID"
  wait 2>/dev/null || true
  log "done"
}
trap cleanup EXIT INT TERM

# ── Preflight: refuse to start if ports are already bound ──
for port in 3001 3000; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    err "port $port is already in use — stop the existing process first"
    exit 1
  fi
done

# ── Build step ──
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "building platform…"
  pnpm --filter @abacus/platform build 2>&1 | tail -3

  if [[ "$WITH_DASHBOARD" -eq 1 ]]; then
    log "building marathon dashboard…"
    pnpm --filter @abacus-products/marathon-dashboard build 2>&1 | tail -5
  fi
  log "builds complete"
else
  log "skipping build (--skip-build)"
fi

# ── Start platform (compiled) ──
log "starting platform (production, :3001)…"
ABACUS_RUNNER="${ABACUS_RUNNER:-claude}" \
  pnpm --filter @abacus/platform start \
  >"$LOG_DIR/platform.log" 2>&1 &
PLATFORM_PID=$!
sleep 2

if ! kill -0 "$PLATFORM_PID" 2>/dev/null; then
  err "platform failed to start — see $LOG_DIR/platform.log"
  tail -20 "$LOG_DIR/platform.log"
  exit 1
fi
log "platform running (pid $PLATFORM_PID)"

# ── Start dashboard (production) ──
if [[ "$WITH_DASHBOARD" -eq 1 ]]; then
  log "starting marathon dashboard (production, :3000)…"
  pnpm --filter @abacus-products/marathon-dashboard start \
    >"$LOG_DIR/dashboard.log" 2>&1 &
  DASHBOARD_PID=$!
  sleep 2
  if ! kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    err "dashboard failed to start — see $LOG_DIR/dashboard.log"
    tail -20 "$LOG_DIR/dashboard.log"
    exit 1
  fi
  log "dashboard running (pid $DASHBOARD_PID) — http://127.0.0.1:3000"
fi

# ── Tunnel + Strava subscription ──
if [[ "$WITH_TUNNEL" -eq 1 ]]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    err "cloudflared not found — skipping tunnel"
  else
    log "starting cloudflared tunnel…"
    cloudflared tunnel --url http://127.0.0.1:3001 \
      >"$LOG_DIR/cloudflared.log" 2>&1 &
    TUNNEL_PID=$!
    sleep 5

    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -1 || true)
    if [[ -z "$TUNNEL_URL" ]]; then
      err "could not detect tunnel URL — see $LOG_DIR/cloudflared.log"
    else
      log "tunnel: $TUNNEL_URL"
      CALLBACK="${TUNNEL_URL}/api/marathon/webhook/strava"
      log "registering Strava subscription → $CALLBACK"
      SUBSCRIPTION_ID=$(pnpm --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
        --callback "$CALLBACK" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
      if [[ -n "$SUBSCRIPTION_ID" ]]; then
        log "Strava subscription ID: $SUBSCRIPTION_ID"
      else
        err "failed to register Strava subscription — see logs"
      fi
    fi
  fi
fi

log "ready — platform :3001, dashboard :3000"
log "press Ctrl-C to stop"
wait
