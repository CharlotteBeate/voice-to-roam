#!/usr/bin/env bash
# Deploy the capture page to Cloudflare Pages.
#
# The --branch flag is not optional cosmetics. Cloudflare only serves the stable
# https://voice-to-roam.pages.dev from a *production* deployment, and a
# deployment counts as production only when its branch matches the project's
# configured production branch, which is "voice-to-roam". Wrangler otherwise
# infers the branch from whatever git repo you happen to be standing in — the
# first deploy was tagged "master" because it ran inside the
# following-your-instruction checkout, and the bare domain 404'd as a result.
set -euo pipefail

cd "$(dirname "$0")"

exec npx --yes wrangler pages deploy web \
  --project-name=voice-to-roam \
  --branch=voice-to-roam
