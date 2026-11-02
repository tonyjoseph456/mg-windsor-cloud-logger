# MG iSMART India — iPhone 14 Plus Connected EV App & TypeScript SDK

A complete reverse-engineered port and mobile application built from [`john-lazarus/mg-ismart-india-client`](https://github.com/john-lazarus/mg-ismart-india-client), tailored for **iPhone 14 Plus** and developed on **Windows**.

---

## Architecture & What Was Built

1. **Pure TypeScript Protocol & ASN.1 UPER SDK ([`src/sdk/`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/index.ts))**
   - **[`bitcodec.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/bitcodec.ts)**: 1:1 port of `PackedBitReader`, `PackedBitWriter`, and 7-bit fixed-width bit manipulation.
   - **[`asn1-uper.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/asn1-uper.ts)**: Complete Unaligned Packed Encoding Rules (UPER) compiler/codec for `ASN_V21` (`MPDispatcherBody`, `OTARVMVehicleStatusResp513`, `OTARVMVehicleChargingStatusResp`, `OTARVCReq`, `OTARVCStatus513`, `RvsPosition`) and `ASN_V11` (`MPDispatcherBodyV11`, `PINVerificationReq`). Verified byte-for-byte against captured MG Windsor EV frames.
   - **[`crypto.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/crypto.ts)**: `tapSignature` (HMAC-SHA256 with MD5 key slice), `gatewaySignature` (triple-MD5 + HMAC-SHA256), `hashControlPin` (`MD5(pin + "00")`), and `decryptGatewayBody` (AES-CBC PKCS7).
   - **[`tap.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/tap.ts) & [`client.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/client.ts)**: Full `MgIndiaClient` supporting `login()`, `vehicles()`, `status(includeCharge)`, `chargeStatus()`, `verifyPin()`, `controlDoorLock()`, `controlClimate()`, `controlWindows()`, `controlSunroof()`, `findMyCar()`, `releaseTailgate()`, and `controlHeatedSeats()`.

2. **Installable iOS Progressive Web App (PWA) ([`src/App.tsx`](file:///c:/Work/Tony/Antigravity/Demo/src/App.tsx))**
   - Designed specifically for the **iPhone 14 Plus** viewport (`430×932 pt`) with safe-area insets, dark-mode glassmorphic UI, and Home Screen Web App manifest (`apple-mobile-web-app-capable`).
   - Includes **Simulator Mode** (with MG Windsor EV, MG ZS EV, and MG Comet EV profiles) and **Live MG India API Mode**.

3. **React Native (Expo) Native Mobile App ([`mobile-expo/App.tsx`](file:///c:/Work/Tony/Antigravity/Demo/mobile-expo/App.tsx))**
   - Shares the exact same `src/sdk` TypeScript protocol engine.
   - Runs natively via **Expo Go** on your iPhone 14 Plus (or sideloaded via AltStore / SideStore) and communicates directly with `https://iov-tap.mgindia.co.in` without browser CORS restrictions.

4. **24/7 Standalone Edge Relay ([`cloudflare-worker/worker.ts`](file:///c:/Work/Tony/Antigravity/Demo/cloudflare-worker/worker.ts)) & Local Relay ([`server/cors-proxy.ts`](file:///c:/Work/Tony/Antigravity/Demo/server/cors-proxy.ts))**
   - Allows the Safari Home Screen PWA on your iPhone 14 Plus to talk to MG India's servers even when your Windows PC is turned off.

---

## How to Use on Your iPhone 14 Plus (from Windows)

### Option 1: Install as a Full-Screen iOS Home Screen App (PWA — Never Expires!)

1. **For 24/7 use anywhere (Windows PC turned off):**
   - Deploy the single-file [`cloudflare-worker/worker.ts`](file:///c:/Work/Tony/Antigravity/Demo/cloudflare-worker/worker.ts) to a free Cloudflare Worker, and deploy the static `dist/` folder to Cloudflare Pages / Vercel / Netlify.
   - Open that HTTPS URL in **Safari** on your iPhone 14 Plus.
   - Tap the **Share** icon at the bottom of Safari → **Add to Home Screen**.
   - Open **MG iSMART** from your iPhone Home Screen, go to **Setup → Live MG India API**, enter your phone, password, 4-digit PIN, and Worker URL.

2. **For instant local testing over Wi-Fi right now:**
   - Start the dev server on your Windows PC (`npm run dev`) and optional local relay (`npm run proxy`).
   - Open `http://<YOUR_WINDOWS_LAN_IP>:5173` in Safari on your iPhone 14 Plus.

### Option 2: Run Natively via Expo Go (No Proxy Needed)

1. Install **Expo Go** from the iOS App Store on your iPhone 14 Plus.
2. Inside [`mobile-expo/`](file:///c:/Work/Tony/Antigravity/Demo/mobile-expo/package.json), run `npm install && npx expo start`.
3. Scan the QR code with your iPhone 14 Plus camera to launch the native React Native client directly on your phone.
