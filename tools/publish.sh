#!/usr/bin/env bash
# publish.sh — ship a fresh build of app-crm to the Render static site.
#
# The hosted app deploys from the dedicated PUBLIC repo
#   https://github.com/1semptify-arch/app-crm
# (Render autoSync rebuilds on every push). This script snapshots the
# canonical module (master-repo/modules/app-crm — its own private repo
# 1semptify-arch/app-crm-src since 2026-11-22) into a staging clone,
# applies the deploy-only transformations, commits, and pushes.
#
# Deploy-only transformations vs canonical source:
#   - src/data/campaignSeed.ts is stubbed to empty arrays (campaign data
#     stays private — the ?seed=campaign flow simply seeds nothing)
#   - docs/CAMPAIGN_*.md, OUTREACH_DRAFTS.md, bill-presentation.* excluded
#   - node_modules, dist, .env.local, verify/ never ship
#
# Usage (git-bash):
#   tools/publish.sh "commit message"
# Requires: gh CLI authed as 1semptify-arch.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MSG="${1:?usage: publish.sh \"commit message\"}"
STAGE_DIR="$(mktemp -d)/app-crm"

mkdir -p "$STAGE_DIR"
cd "$STAGE_DIR"
git clone -q --depth 1 https://github.com/1semptify-arch/app-crm.git .
git rm -r -q --cached . >/dev/null 2>&1 || true
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

cd "$HERE"
cp -r src public index.html package.json package-lock.json tsconfig.json \
      vite.config.ts tailwind.config.js postcss.config.js supabase tools \
      docs README.md .env.example .gitignore render.yaml "$STAGE_DIR/"

cd "$STAGE_DIR"
rm -f docs/CAMPAIGN_7DAY.md docs/CAMPAIGN_AGENDA.md docs/CAMPAIGN_CONTACTS.md \
      docs/OUTREACH_DRAFTS.md docs/bill-presentation.html docs/bill-presentation.pdf
rm -rf tools/__pycache__

cat > src/data/campaignSeed.ts <<'STUB'
import type { AppointmentInput, ContactInput } from '../types';

// Deploy-repo build: campaign seed data is stripped — it lives in the
// canonical repo (master-repo/modules/app-crm), which is private. The
// ?seed=campaign flow stays wired; it just seeds nothing here.

export const CONTACTS: ContactInput[] = [];
export const APPOINTMENTS: AppointmentInput[] = [];
STUB

cat > .gitignore <<'GI'
node_modules/
dist/
.env.local
verify/
GI

git add -A
if git diff --cached --quiet; then
  echo "no changes to publish"
  exit 0
fi
git -c user.email=devin@cognition.ai -c user.name=devin commit -qm "$MSG"
git push -q origin HEAD
echo "pushed — Render rebuilds in ~2 min (autoSync on)."
