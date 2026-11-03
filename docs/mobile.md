# Player mobile app (apps/mobile)

Expo SDK 58 / React Native 0.88 / expo-router. Bundle id `com.bookaturf.player`, URL scheme `bookaturf`. Player features only.

## Which path to use

| Path | Works for | Notes |
| --- | --- | --- |
| **EAS dev build on a phone (use this on this machine)** | Everything, including Stripe | Built in Expo's cloud, installed on your device |
| Local simulator build (`expo run:ios`) | Everything | Needs **Xcode 26**, which needs **macOS 15.6+**. This machine has Xcode 16.2 / macOS 14.5, so it will not build SDK 58 (expo's `Package.swift` needs Swift tools 6.2; expo-router uses iOS 26 APIs) |
| Expo Go | Browsing only | **Stripe does not work in Expo Go.** Use a dev build for checkout |

## 1. EAS dev build (cloud)

One-time setup (yours to do; nothing here has been run for you):

1. Create an Expo account at expo.dev.
2. Install the CLI: `npm i -g eas-cli` (or prefix commands with `pnpm dlx eas-cli`). Then `eas login`.
3. From `apps/mobile`: `eas init`. It creates the project and writes `extra.eas.projectId` into `app.json`. Commit that.
4. **iOS device installs need a paid Apple Developer account** (USD 99/yr). Register the iPhone: `eas device:create` (it gives a link or QR to open on the phone), then build.
5. Android needs no store account for an APK.

Set the API address before building. A phone cannot reach `localhost`, so `eas.json` has a placeholder `EXPO_PUBLIC_API_URL` (`http://REPLACE_WITH_LAN_IP:4000/api/v1`) in the `base` profile. Edit it to your machine's LAN IP (`ipconfig getifaddr en0`) before building (shell variables are not forwarded to EAS builds). Do not commit your personal IP. If the IP changes or you are on another network, use a tunnel (`cloudflared tunnel --url http://localhost:4000` or ngrok) and its https URL instead. While developing, the value you pass to `expo start` overrides the baked one.

```bash
cd apps/mobile
eas build --profile development --platform ios
eas build --profile development --platform android
```

Then:

1. Install the build from the link EAS prints (iOS: open on the registered iPhone; Android: download the APK).
2. Run the API (`pnpm dev` from the repo root; make sure it listens on all interfaces and the phone is on the same Wi-Fi). Native requests are not subject to CORS.
3. From `apps/mobile`: `EXPO_PUBLIC_API_URL=http://<LAN IP>:4000/api/v1 npx expo start --dev-client`. Open the installed app and connect.

Profiles in `apps/mobile/eas.json`:

- `development`: dev client, internal distribution, real devices (iOS device build, Android APK).
- `development-simulator`: same, but `ios.simulator: true`. Use it once you are on macOS 15.6+ with Xcode 26.
- `preview`: internal APK / ad-hoc iOS for testers. Needs a real https API in `EXPO_PUBLIC_API_URL` (release builds block cleartext http).
- `production`: Android app bundle and iOS store build, build number auto-incremented (`appVersionSource: remote`).

Replace the `REPLACE_WITH_*` hosts before building `preview` / `production`. Release builds: `eas build -p android --profile preview`, `eas build -p ios --profile production`.

Store accounts are yours to create: **Apple Developer Program** (App Store Connect, TestFlight, `eas submit -p ios`) and **Google Play Console** (one-time USD 25, `eas submit -p android`).

## Local builds (later, after upgrading macOS)

Needs macOS 15.6+, Xcode 26. After installing: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, `sudo xcodebuild -license accept`, then `pnpm --filter mobile ios` (builds the dev client for a simulator). Android: Android Studio, an emulator, `ANDROID_HOME` set, `pnpm --filter mobile android`. The emulator reaches the host at `http://10.0.2.2:4000/api/v1`; the iOS simulator can use `localhost`.

## Monorepo notes

The app imports `@booking/shared` (workspace package) and the web locale JSON (`apps/web/src/i18n/locales/*.json`, via a relative path). Expo SDK 58's Metro config detects the pnpm workspace by itself (watch folders and `node_modules` lookup paths), so no `metro.config.js` is needed. `expo export` for both platforms bundles successfully. EAS uploads the git repo root and runs `pnpm install` there, so keep `pnpm-lock.yaml` committed and the files above in git.

## Assets

Icon, adaptive icon, favicon and light/dark splash images are generated from the web mark (`apps/web/public/favicon.svg`) with token colours: `pnpm --filter mobile icons` (needs Google Chrome). Splash and adaptive-icon background colours in `app.json` are the `bgPage` (light and dark) and `primary` tokens; JSON cannot import tokens, so update them by hand if the tokens change.

## Known limits

- **SSLCommerz**: the gateway redirects to the web `APP_URL`, not back into the app. The player dismisses the in-app browser; the booking screen then refetches and shows the real status.
- Wallet (bKash/Nagad) payments are manual: the player sends money, then submits the Transaction ID, which the owner verifies.

## Manual end-to-end checklist

Run on a real iPhone and an Android phone, API on the LAN.

- [ ] Find a venue (search, filters, location prompt) and open it
- [ ] Pick court, date, slot; check out
- [ ] Pay with Stripe test card `4242 4242 4242 4242`, any future date, any CVC
- [ ] Booking appears under Bookings as confirmed; open detail
- [ ] Cancel it; status and refund note update
- [ ] Repeat the key screens in light and dark mode, and in `ru` and `bn` (nothing truncated or overlapping)
- [ ] Pay at venue flow works
- [ ] bKash/Nagad: submit a Transaction ID after the hold is nearly expired; late submission is handled
- [ ] Hold expiry: sit on the payment screen past `holdExpiresAt`; "hold expired, pick again" appears, no stuck spinner
- [ ] Background or kill the app mid-payment (Stripe sheet, SSLCommerz browser); on return the booking shows the real status
- [ ] Set the device timezone different from the venue's; slot grid and booking times stay in the venue's timezone
- [ ] Sign in by phone OTP and by email; sign out
