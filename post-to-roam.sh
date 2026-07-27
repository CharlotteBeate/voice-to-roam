#!/usr/bin/env bash
# Append a line to today's Roam daily note via Roam's hosted backend API.
#
# This is the reference implementation of the contract the iOS Shortcut uses —
# run it first to prove the token, graph name and payloads are right, so that a
# failure in the Shortcut is a Shortcut problem and not an API problem.
#
# Nothing here touches the Mac's local Roam API (127.0.0.1:3333). That one is
# loopback-only, which is exactly why the phone could never reach it.
#
#   export ROAM_GRAPH=your-graph-name
#   export ROAM_API_TOKEN=roam-graph-token-...     # never commit this
#   ./post-to-roam.sh "a thought worth keeping"
#   ./post-to-roam.sh --dry-run "shows the JSON, sends nothing"
set -euo pipefail

API_HOST="https://api.roamresearch.com"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi

TEXT="${*:-}"
if [ -z "$TEXT" ]; then
  echo "usage: $0 [--dry-run] <text to append>" >&2
  exit 64
fi

GRAPH="${ROAM_GRAPH:-}"
TOKEN="${ROAM_API_TOKEN:-}"
if [ "$DRY_RUN" -eq 0 ]; then
  [ -n "$GRAPH" ] || { echo "ROAM_GRAPH is not set" >&2; exit 78; }
  [ -n "$TOKEN" ] || { echo "ROAM_API_TOKEN is not set" >&2; exit 78; }
fi

# Roam identifies a daily note page by a uid of MM-DD-YYYY, and titles it with an
# ordinal day ("July 27th, 2026"). Both must agree or you get a page that Roam
# does not treat as that day's note.
UID_TODAY="$(date +%m-%d-%Y)"
DAY="$(date +%-d)"
case "$DAY" in
  11|12|13) SUFFIX="th" ;;
  *1)       SUFFIX="st" ;;
  *2)       SUFFIX="nd" ;;
  *3)       SUFFIX="rd" ;;
  *)        SUFFIX="th" ;;
esac
TITLE="$(date +%B) ${DAY}${SUFFIX}, $(date +%Y)"

# Build the JSON with python3 so quotes, newlines and non-ASCII in dictated text
# cannot break out of the string.
payloads="$(python3 - "$TITLE" "$UID_TODAY" "$TEXT" <<'PY'
import json, sys
title, uid, text = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"action": "create-page",
                  "page": {"title": title, "uid": uid}}))
print(json.dumps({"action": "create-block",
                  "location": {"parent-uid": uid, "order": "last"},
                  "block": {"string": text}}))
PY
)"
CREATE_PAGE="$(printf '%s\n' "$payloads" | sed -n 1p)"
CREATE_BLOCK="$(printf '%s\n' "$payloads" | sed -n 2p)"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "daily note : $TITLE   (uid $UID_TODAY)"
  echo "create-page: $CREATE_PAGE"
  echo "create-block: $CREATE_BLOCK"
  exit 0
fi

# --location-trusted, not -L: the write endpoint answers 308 to a
# peer-N.api.roamresearch.com host, and plain -L drops the Authorization header
# on a cross-host redirect, which surfaces as a baffling 401.
roam_write() {
  curl -sS -X POST "$API_HOST/api/graph/$GRAPH/write" \
    --location-trusted \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -w '\n%{http_code}' \
    --max-time 30 \
    -d "$1"
}

# The daily note may not exist yet if you capture before opening Roam that day.
# Creating it when it already exists is a no-op error, so this ignores the result.
roam_write "$CREATE_PAGE" >/dev/null 2>&1 || true

response="$(roam_write "$CREATE_BLOCK")"
code="$(printf '%s' "$response" | tail -n1)"
body="$(printf '%s' "$response" | sed '$d')"

case "$code" in
  200|201) echo "appended to $TITLE" ;;
  401|403) echo "auth rejected (HTTP $code). Check the token, and that it has write scope." >&2
           [ -n "$body" ] && echo "$body" >&2; exit 1 ;;
  *)       echo "failed (HTTP $code)" >&2
           [ -n "$body" ] && echo "$body" >&2; exit 1 ;;
esac
