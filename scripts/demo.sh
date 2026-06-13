#!/usr/bin/env bash
# CareSwarm demo launcher — starts agents + orchestrator + dashboard.
# Usage: ./scripts/demo.sh          (foreground logs in ./logs/)
#        ./scripts/demo.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."

# Load local config (.env) — e.g. QVAC_MODELS_DIR / QVAC_CACHE_DIR on an
# external drive. Safe to skip if absent (uses code defaults).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

LOG_DIR=logs
mkdir -p "$LOG_DIR" data

if [ "${1:-}" = "stop" ]; then
  pkill -f "tsx services/" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  echo "🛑 CareSwarm stopped."
  exit 0
fi

echo "🐝 Starting CareSwarm (8GB RAM choreography)…"

# 4.0GB lets MedPsy-4B (3.4) + embeddings (0.5) coexist → no reload between
# clinician tool-call rounds. Still leaves headroom for the OS on 8GB.
QVAC_RAM_BUDGET_GB=4.0 CARESWARM_PROCESS=agents \
  npx tsx services/agents/src/index.ts >> "$LOG_DIR/agents.log" 2>&1 &
AGENTS_PID=$!

QVAC_RAM_BUDGET_GB=1.8 CARESWARM_PROCESS=orchestrator \
  npx tsx services/orchestrator/src/orchestrator.ts >> "$LOG_DIR/orchestrator.log" 2>&1 &
ORCH_PID=$!

# Dashboard: production build if available, dev otherwise
if [ -d apps/dashboard/.next ]; then
  (cd apps/dashboard && npm run start >> "../../$LOG_DIR/dashboard.log" 2>&1) &
else
  echo "   (no production build — run 'npm run build -w @careswarm/dashboard' first for lowest RAM; using dev)"
  (cd apps/dashboard && npm run dev >> "../../$LOG_DIR/dashboard.log" 2>&1) &
fi
DASH_PID=$!

sleep 6
echo ""
echo "  agents       :3001  (pid $AGENTS_PID)"
echo "  orchestrator :4000  (pid $ORCH_PID)"
echo "  dashboard    :3000  (pid $DASH_PID)  →  http://localhost:3000"
echo ""
echo "  P2P provider (optional, second terminal):  npm run provider"
echo "  Stop everything:                           ./scripts/demo.sh stop"
