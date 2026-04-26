#!/usr/bin/env bash
# dev-up.sh — one command to bring the whole stack up for development.
#
# Starts (in this order):
#   1. Abacus platform (Fastify on :3001, ABACUS_RUNNER=claude)
#   2. Product dashboards (marathon Next.js on :3000)
#   3. cloudflared quick tunnel → prints a public https URL
#   4. Strava webhook subscription pointing at that tunnel URL
#
# On SIGINT / SIGTERM / EXIT: deletes the Strava subscription and kills all
# child processes.
#
# Flags:
#   --no-tunnel   skip cloudflared + Strava subscription
#   --no-dashboard skip starting the marathon dashboard
#
# Logs:
#   runtime/dev-logs/{platform,dashboard,cloudflared}.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

WITH_TUNNEL=1
WITH_DASHBOARD=1
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) WITH_TUNNEL=0 ;;
    --no-dashboard) WITH_DASHBOARD=0 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "[dev-up] unknown flag: $arg" >&2; exit 2 ;;
  esac
done

LOG_DIR="$REPO_ROOT/runtime/dev-logs"
mkdir -p "$LOG_DIR"

PLATFORM_PID=""
DASHBOARD_PID=""
TUNNEL_PID=""
TUNNEL_URL=""
SUBSCRIPTION_ID=""

log() { echo "[dev-up] $*"; }
err() { echo "[dev-up] $*" >&2; }

kill_tree() {
  # Recursively TERM a pid and all its descendants (macOS-friendly, no setsid).
  local pid="$1" sig="${2:-TERM}"
  [ -z "$pid" ] && return 0
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    kill_tree "$c" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

CLEANED_UP=0
cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then return; fi
  CLEANED_UP=1
  trap - EXIT INT TERM
  echo ""
  log "shutting down..."

  if [ -n "$SUBSCRIPTION_ID" ]; then
    log "deleting Strava subscription $SUBSCRIPTION_ID..."
    pnpm --silent --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
      --delete "$SUBSCRIPTION_ID" 2>&1 | sed 's/^/  /' || true
  fi

  kill_tree "$TUNNEL_PID" TERM
  kill_tree "$DASHBOARD_PID" TERM
  kill_tree "$PLATFORM_PID" TERM
  sleep 1
  kill_tree "$TUNNEL_PID" KILL
  kill_tree "$DASHBOARD_PID" KILL
  kill_tree "$PLATFORM_PID" KILL

  log "bye"
}
trap cleanup EXIT INT TERM

require_port_free() {
  local port="$1" pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    err "port $port already bound. Listeners:"
    echo "$pids" | xargs -I{} ps -p {} -o pid,command 2>&1 | sed 's/^/  /' >&2 || true
    err "stop them first, then re-run."
    exit 1
  fi
}

wait_http() {
  local url="$1" label="$2"
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      log "$label ready"
      return 0
    fi
    sleep 0.5
  done
  err "$label never came up at $url (see $LOG_DIR/)"
  return 1
}

wait_log_match() {
  # Poll a log file for a regex that signals readiness.
  local logfile="$1" pattern="$2" label="$3"
  for _ in $(seq 1 120); do
    if [ -f "$logfile" ] && grep -qE "$pattern" "$logfile" 2>/dev/null; then
      log "$label ready"
      return 0
    fi
    sleep 0.5
  done
  err "$label never emitted match /$pattern/ in $logfile"
  return 1
}

# --- prereqs ---
log "log dir: $LOG_DIR"
require_port_free 3001
[ "$WITH_DASHBOARD" = "1" ] && require_port_free 3000

if [ "$WITH_TUNNEL" = "1" ] && ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared not found. Install (brew install cloudflared) or re-run with --no-tunnel"
  exit 1
fi

# --- platform ---
log "starting platform on :3001..."
ABACUS_RUNNER=claude \
pnpm --filter @abacus/platform dev \
  > "$LOG_DIR/platform.log" 2>&1 &
PLATFORM_PID=$!
wait_http "http://127.0.0.1:3001/health" "platform"

# --- dashboard ---
if [ "$WITH_DASHBOARD" = "1" ]; then
  log "starting marathon dashboard on :3000..."
  pnpm --filter @abacus-products/marathon-dashboard dev \
    > "$LOG_DIR/dashboard.log" 2>&1 &
  DASHBOARD_PID=$!
  # Next.js prints "Ready in …" once bindings are up. Don't HTTP-probe here —
  # SSR spawns tsx cold on every request, easily exceeding any curl timeout.
  wait_log_match "$LOG_DIR/dashboard.log" 'Ready in [0-9]' "dashboard"
fi

# --- tunnel + subscription ---
if [ "$WITH_TUNNEL" = "1" ]; then
  log "clearing stale Strava subscriptions..."
  pnpm --silent --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --list 2>/dev/null \
    | awk '/^\[strava-subscribe\] id=/ { sub(/^id=/, "", $2); print $2 }' \
    | while read -r sid; do
        # strip "id=" if awk left it
        sid="${sid#id=}"
        [ -z "$sid" ] && continue
        log "  deleting stale subscription $sid"
        pnpm --silent --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts --delete "$sid" 2>&1 | sed 's/^/    /' || true
      done

  log "starting cloudflared tunnel..."
  : > "$LOG_DIR/cloudflared.log"
cloudflared tunnel --url http://127.0.0.1:3001 \
    > "$LOG_DIR/cloudflared.log" 2>&1 &
  TUNNEL_PID=$!

  log "waiting for tunnel URL..."
  for _ in $(seq 1 120); do
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" 2>/dev/null | head -1 || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 0.5
  done
  if [ -z "$TUNNEL_URL" ]; then
    err "tunnel URL never appeared. Last 20 lines of log:"
    tail -20 "$LOG_DIR/cloudflared.log" >&2
    exit 1
  fi
  log "tunnel URL: $TUNNEL_URL"

  # Wait for cloudflared to actually register the connection (URL prints
  # before that). Edge routing still propagates after this, so we also retry
  # the subscribe on transient failure.
  wait_log_match "$LOG_DIR/cloudflared.log" 'Registered tunnel connection' "tunnel connection"
  sleep 3

  # strava-subscribe: retry up to 3 times (edge routing may still be warming up
  # for a fresh trycloudflare hostname).
  log "registering Strava subscription..."
  set +e
  for attempt in 1 2 3; do
    SUB_OUT=$(pnpm --silent --filter @abacus-products/marathon exec tsx scripts/strava-subscribe.ts \
      --callback "$TUNNEL_URL/api/marathon/webhook/strava" 2>&1)
    SUB_EXIT=$?
    if [ "$SUB_EXIT" = "0" ]; then break; fi
    err "  attempt $attempt failed (exit $SUB_EXIT). Output:"
    echo "$SUB_OUT" | sed 's/^/    /' >&2
    sleep 5
  done
  set -e
  if [ "$SUB_EXIT" != "0" ]; then
    err "strava-subscribe failed after 3 attempts"
    exit 1
  fi
  echo "$SUB_OUT" | sed 's/^/  /'
  SUBSCRIPTION_ID=$(echo "$SUB_OUT" | grep -oE 'subscription id=[0-9]+' | head -1 | awk -F= '{print $2}')
  if [ -z "$SUBSCRIPTION_ID" ]; then
    err "could not parse subscription id from output"
    exit 1
  fi
fi

echo ""
echo "=========================================================="
echo "  Dashboard:  http://localhost:3000"
echo "  Platform:   http://127.0.0.1:3001"
if [ -n "$TUNNEL_URL" ]; then
  echo "  Tunnel:     $TUNNEL_URL"
  echo "  Webhook:    $TUNNEL_URL/api/marathon/webhook/strava"
  echo "  Sub id:     $SUBSCRIPTION_ID"
fi
echo ""
echo "  Logs:       $LOG_DIR/"
echo "  Ctrl-C to shut down (cleans up tunnel + subscription)."
echo "=========================================================="

# wait for any child to die
wait
