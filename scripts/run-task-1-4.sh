#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

pass() {
  echo "[PASS] $1"
}

# Task 1: SW cache/offline strategy
rg -n "\./styles/tokens\.css|\./styles/base\.css|\./styles/screens\.css|\./styles/components\.css" sw.js >/dev/null || fail "Task1: CSS files are not fully precached in sw.js"
rg -n "self\.addEventListener\('activate'" sw.js >/dev/null || fail "Task1: activate handler for cache cleanup is missing"
rg -n "isStyleRequest|destination === 'style'|stale-while-revalidate" sw.js >/dev/null || fail "Task1: style fetch strategy is missing"
pass "Task1 checks (SW offline quality)"

# Task 2: footer info dialog markup integrity
rg -n "<dialog id=\"footerInfoDialog\"" index.html >/dev/null || fail "Task2: footerInfoDialog not found"
rg -n "<button id=\"footerInfoDialogClose\"" index.html >/dev/null || fail "Task2: explicit close button in dialog not found"
pass "Task2 checks (dialog structure)"

# Task 3: trust links should not be dummy href="#"
if rg -n 'href="#"' index.html signup.html >/dev/null; then
  fail "Task3: dummy trust links (href=\"#\") still exist"
fi
rg -n "privacy\.html|terms\.html|contact\.html" index.html signup.html >/dev/null || fail "Task3: trust links are not wired to real pages"
pass "Task3 checks (trust links)"

# Task 4: zero-setup replaces the retired questionnaire.
if rg -n "onboardingCard|buildOnboardingRecommendation|applyOnboardingPlan" index.html scripts/app/main.js; then
  fail "Task4: retired onboarding remains"
fi
pass "Task4 checks (zero setup)"
