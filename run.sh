#!/usr/bin/env bash
set -euo pipefail

# Supervisor injects this token; we’ll pass it to Node for HA API calls
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"

# Options live at /data/options.json
exec node /opt/auto_banker/index.js /data/options.json
