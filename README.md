# MG iSMART India — iPhone 14 Plus Connected EV App & TypeScript SDK

A complete reverse-engineered port and mobile application built from [`john-lazarus/mg-ismart-india-client`](https://github.com/john-lazarus/mg-ismart-india-client) and [`irshadm/volta-android`](https://github.com/irshadm/volta-android), tailored for **iPhone 14 Plus** (iOS PWA + CarPlay Webhooks) and developed on **Windows**.

---

## Architecture & What Was Built

1. **Pure TypeScript Protocol & ASN.1 UPER SDK ([`src/sdk/`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/index.ts))**
   - **[`bitcodec.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/bitcodec.ts)**: 1:1 port of `PackedBitReader`, `PackedBitWriter`, and 7-bit fixed-width bit manipulation.
   - **[`asn1-uper.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/asn1-uper.ts)**: Complete Unaligned Packed Encoding Rules (UPER) compiler/codec for `ASN_V21` (`MPDispatcherBody`, `OTARVMVehicleStatusResp513`, `OTARVMVehicleChargingStatusResp`, `OTARVCReq`, `OTARVCStatus513`, `RvsPosition`) and `ASN_V11` (`MPDispatcherBodyV11`, `PINVerificationReq`). Verified byte-for-byte against captured MG Windsor EV frames.
   - **[`crypto.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/crypto.ts)**: `tapSignature` (HMAC-SHA256 with MD5 key slice), `gatewaySignature` (triple-MD5 + HMAC-SHA256), `hashControlPin` (`MD5(pin + "00")`), and `decryptGatewayBody` (AES-CBC PKCS7).
   - **[`tap.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/tap.ts) & [`client.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/client.ts)**: Full `MgIndiaClient` supporting `login()`, `vehicles()`, `status(includeCharge)`, `chargeStatus()`, `verifyPin()`, `controlDoorLock()`, `controlClimate()`, `controlWindows()`, `controlSunroof()`, `findMyCar()`, `releaseTailgate()`, and `controlHeatedSeats()`.

2. **EV Trip Planner & Terrain Physics Engine ([`src/sdk/tripPlanner.ts`](file:///c:/Work/Tony/Antigravity/Demo/src/sdk/tripPlanner.ts) & [`mobile-expo/src/TripPlannerCard.tsx`](file:///c:/Work/Tony/Antigravity/Demo/mobile-expo/src/TripPlannerCard.tsx))**
   - Ported from **[`irshadm/volta-android`](https://github.com/irshadm/volta-android)** by **Irshad Melethil** (Apache License 2.0).
   - **Terrain-Aware Physics (`EnergyModel` & `Terrain`)**: Computes flat speed-dependent consumption (`cityKmPerKwh` to `highwayKmPerKwh`) plus gravitational potential energy ($E = m \cdot g \cdot \Delta h$) for hill/ghat climbs and regenerative braking on descents, using a 20m hysteresis filter to reject DEM bridge/road noise.
   - **Time-Optimal Dijkstra Stop Planner (`VoltaTripPlanner`)**: Searches over `(charger, departure-SoC)` states using the MG Windsor EV DC charging curve (`WINDSOR_38_DC_CURVE`) to compute **Fastest Total Time**, **Fewer Stops**, and **Preferred Network** plans.
   - **Automatic Backup Chargers & Offline Re-Planning**: Evaluates a 1–5 dot reliability score for each planned stop, selects a **backup DC fast charger within 25 km along the route**, and lets you mark any charger **Offline/Broken** in 1 tap to immediately re-plan the route around it.
   - **Hybrid Map & Charger Data Engine**:
     - **Free / Zero-Key Mode (Default)**: Works out of the box with zero API keys using OSRM Routing, Open-Meteo 90m SRTM DEM Elevation, OpenStreetMap Nominatim/Overpass, and a curated South India DC Fast Charger corridor database.
     - **Optional Google Maps Platform Mode**: Paste a Google Maps API key in the Planner settings to unlock Google Routes v2 Live Traffic delays, Google Places Autocomplete, and live CCS2 free plug counts along your route.

3. **Installable iOS Progressive Web App (PWA) & React Native (Expo) App ([`mobile-expo/App.tsx`](file:///c:/Work/Tony/Antigravity/Demo/mobile-expo/App.tsx))**
   - Designed specifically for the **iPhone 14 Plus** viewport (`430×932 pt`) with safe-area insets, dark-mode glassmorphic UI, iOS Lock Screen "Now Playing" silent audio charging widget, and Native W3C Web Push (Apple APNs + Android FCM).

4. **24/7 Cloudflare Worker & D1 Telemetry Backend ([`cloudflare-worker/multi-worker.ts`](file:///c:/Work/Tony/Antigravity/Demo/cloudflare-worker/multi-worker.ts))**
   - Handles Apple CarPlay trip start/stop webhooks, smart 12V-safe AC/DC charging tracking, Google Sheets backup, and native Web Push notifications.

---

## Credits & Acknowledgements

- **[Irshad Melethil (`@irshadm`) — `volta-android`](https://github.com/irshadm/volta-android)** ([irshadm.dev/volta](https://irshadm.dev/volta/)): Author of **Volta**, the open-source Android app for MG EVs in India. The EV Trip Planner, physics-based elevation `EnergyModel`, 20m `Terrain` ascent filter, Dijkstra `OptimalPlanner`, charger confidence scoring, and automatic backup charger selection in this project are ported from `volta-android` under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- **[John Lazarus (`@john-lazarus`) — `mg-ismart-india-client`](https://github.com/john-lazarus/mg-ismart-india-client)**: Reverse-engineered the MG India i-SMART ASN.1 UPER binary protocol, cryptographic signatures, and vehicle status/control endpoints that power the TypeScript SDK.

---

## How to Use on Your iPhone 14 Plus (from Windows)

### Option 1: Install as a Full-Screen iOS Home Screen App (PWA — Never Expires!)

1. **For 24/7 use anywhere (Windows PC turned off):**
   - Open your deployed HTTPS URL in **Safari** on your iPhone 14 Plus.
   - Tap the **Share** icon at the bottom of Safari → **Add to Home Screen**.
   - Open **MG iSMART** from your iPhone Home Screen, sign in with your MG India phone number, password, and 4-digit PIN.

2. **For instant local testing over Wi-Fi right now:**
   - Start the dev server on your Windows PC (`npm run dev`).
   - Open `http://<YOUR_WINDOWS_LAN_IP>:5173` in Safari on your iPhone 14 Plus.

### Option 2: Run Natively via Expo Go (No Proxy Needed)

1. Install **Expo Go** from the iOS App Store on your iPhone 14 Plus.
2. Inside [`mobile-expo/`](file:///c:/Work/Tony/Antigravity/Demo/mobile-expo/package.json), run `npm install && npx expo start`.
3. Scan the QR code with your iPhone 14 Plus camera to launch the native React Native client directly on your phone.
