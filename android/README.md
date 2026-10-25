# Tobi for Android

The phone side of [Tobi](https://github.com/sailxx/Tobi): your coding agents as Tobi on your phone. Approve or deny their
permission requests (Allow needs your fingerprint or screen lock), answer their questions, chat through your computer's AI
providers, and keep ten Home-screen widgets. Dark by default with Tobi's blue; light and the phone's own colours are in
Settings > Display. Free: no ads, no billing, no analytics, no account.

Based on [Coucou for Android](https://github.com/Louis-CFM/coucou/tree/main/android) by Rhytam Biswas (MIT), which is part of
Coucou by Louis Raillé. The Tobi character, name, icon and sounds are Tobi's own; Coucou's are not used here.

## Install

1. Download `Tobi-Android-<version>.apk` from the [Releases](https://github.com/sailxx/Tobi/releases) page (Android 11 or later).
2. On the computer, Tobi 0.2.0 or later: Settings > Android phone > turn on *Phone link*, then *Show pairing code*.
3. Scan it with the app (or paste the `tobi://pair` link). Phone and computer on the same Wi-Fi; away from home through your own relay (optional).

## Widgets

Ten to pick from on the home screen, all on one dark card with a glow in the colour of the state: Agents summary, Tobi at a glance,
All your agents, Tobi, big, One-line status, Approvals waiting, Plan usage, Finished today, Tobi's mood and Your team. They show
agent names and state words only; a request is always decided in the app, behind your fingerprint.

## Build and test

JDK 17 or 21 and the Android SDK (platform 35). From this folder:

```bash
./gradlew testDebugUnitTest assembleDebug lint
node scripts/gen-strings.mjs --check      # res/values/strings.xml is generated from i18n/app-strings.json
```

`./gradlew assembleRelease` signs with `TOBI_KEYSTORE_FILE`, `TOBI_KEYSTORE_PASSWORD`, `TOBI_KEY_ALIAS` (and `TOBI_KEY_PASSWORD`);
without them the release APK is unsigned. Keys are never in the repository. Without a computer: *Try the demo* in the app, or
`node tools/dev-desktop.mjs --host <LAN IP>` (a pretend computer).

The desktop side is `src-tauri/src/phone_link`; the protocol is [docs/ANDROID_LINK.md](../docs/ANDROID_LINK.md), the optional
relay [docs/RELAY_LINK.md](../docs/RELAY_LINK.md).

## Languages

English, French, Spanish, Brazilian Portuguese, Simplified Chinese, Hindi, Bengali, Russian, Indonesian and Arabic. The English
source is `i18n/app-strings.json`; `node scripts/gen-strings.mjs` writes the resources.
