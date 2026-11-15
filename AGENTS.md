# MG Windsor Cloud Logger — Workspace Rules

## Post-Edit Build, Test & GitHub Push Invariant
After every code modification in this repository:
1. Run verification checks matching what changed (`tsc --noEmit` in `mobile-expo/`, `npx tsx --test` for `cloudflare-worker/__tests__/`).
2. If `cloudflare-worker/*.ts` changed, rebuild `cloudflare-worker/dist-multi-worker.js` using `esbuild`.
3. Run `node mobile-expo/scripts/build-web.mjs` so `mobile-expo/dist-web/` is rebuilt automatically whenever PWA files changed vs. `.pwa-build-hash`.
4. Commit all intended changes with a concise, accurate description and immediately push to `origin/main` non-interactively (never leave background `git push` waiting on credential prompts). Follow `.agents/skills/build-verify-push/SKILL.md` for exact commands and verification checks.

## Telematics & UI Data Integrity Rules
- Never synthesize or display estimated vehicle metrics when real telemetry is absent (do not compute fallback max speed from average speed, do not display idle duration/energy without continuous polling, and display `-- km/kWh` instead of `cycleKm / power_usage_since_last_charge_kwh` while charging).
- Preserve charging session guards: require `gunPluggedIn && !isMoving` before using charging power fallbacks, do not finalize plugged-in/paused sessions on stationary `trip_start` unlock events, and keep 24/7 background trip polling disabled to protect the 12V battery and MG iSmart login.
