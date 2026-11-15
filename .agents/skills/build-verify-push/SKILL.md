---
name: build-verify-push
description: >-
  Run TypeScript/unit tests, rebuild the Cloudflare Worker bundle and conditional
  Expo PWA dist-web output, and execute a fast non-interactive git commit and push
  to origin/main. Use after editing code in mg-windsor-cloud-logger.
---

# Build, Verify & Auto-Push Workflow

Run these steps from `c:\Work\Antigravity\mg-windsor-cloud-logger` after finishing edits.

## 1. Type-Check & Unit Tests

- When `mobile-expo/` changed:
  ```powershell
  Push-Location mobile-expo; .\node_modules\.bin\tsc.cmd --noEmit; $code = $LASTEXITCODE; Pop-Location; exit $code
  ```
- Run worker & math unit tests:
  ```powershell
  npx tsx --test cloudflare-worker/__tests__/charging-sync.test.ts cloudflare-worker/__tests__/multi-user-auth.test.ts mobile-expo/src/sdk/__tests__/liquidGlassMath.test.ts
  ```
  *(Note: `protocol.test.ts` requires the Expo runtime for `__DEV__` / `expo-web-browser` and is not runnable under plain Node ESM.)*

## 2. Rebuild Modified Outputs

- If `cloudflare-worker/*.ts` changed, re-bundle the Worker:
  ```powershell
  .\node_modules\.bin\esbuild.cmd cloudflare-worker/multi-worker.ts --bundle --format=esm --outfile=cloudflare-worker/dist-multi-worker.js
  ```
- Always run the hash-checked PWA builder (skips export automatically if unchanged vs `mobile-expo/.pwa-build-hash`):
  ```powershell
  node mobile-expo/scripts/build-web.mjs
  ```

## 3. Fast Non-Interactive Commit & Push

1. Check `git status --short` (do not commit unrelated lockfile noise).
2. Always guard `git push` so Git Credential Manager never hangs on a multi-account prompt:
   ```powershell
   $env:GIT_TERMINAL_PROMPT='0'
   $env:GCM_INTERACTIVE='never'
   if (-not (git config --local --get credential.https://github.com.username)) {
     git config --local credential.https://github.com.username tonyjoseph456
   }
   git push origin main
   ```
3. Verify sync before reporting success:
   ```powershell
   git rev-list --left-right --count origin/main...main
   ```
   Expect `0 0`. If non-zero or auth fails, report the exact git error instead of leaving a background task running.
