# BillManager Mobile

BillManager Mobile is the React Native client for iOS and Android. It uses Expo development builds, Continuous Native Generation (CNG), and local Expo modules. Expo Go is not a supported runtime because the application depends on SQLCipher, passkeys, widgets, local notification actions, and other native capabilities.

The rewrite is under active development. The current code milestone is `1.0.0-alpha.1` (**Alpha-1**) for internal iOS and Android testing. It contains the new native-adaptive application and offline foundation, but it has not passed the complete device, store, and parity gates required for a public release.

## Documentation

- [Implementation status and release gates](docs/implementation-status.md)
- [Development builds, CNG, EAS, and Mac workflow](docs/development-builds.md)
- [HTTPS, private CA, synchronization, reminder, and widget behavior](docs/runtime-and-deployment.md)
- [Migration from the internal alpha](docs/alpha-migration.md)
- [Maestro Android and iOS device-flow gates](.maestro/README.md)

## Quick start

Prerequisites:

- Node.js 24.18.0
- npm
- an installed BillManager development client or a local Android/iOS native toolchain
- an Expo account for EAS builds

```bash
cd apps/mobile
npm ci
npm start
```

`npm start` runs Metro for a development client. It does not produce an Expo Go-compatible QR code. See the [development build guide](docs/development-builds.md) to create or install a client.

Run the mobile verification suite with:

```bash
npm run check
```

This checks translation codegen and generated OpenAPI drift, runs ESLint, TypeScript, and unit tests, validates Maestro flow definitions and native build-profile transport policy, checks Expo package compatibility, and runs Expo Doctor. Device execution remains a separate release-candidate gate documented in the Maestro guide.

## Source-of-truth rules

- `package.json` owns the semantic mobile release version, including its Alpha-1 prerelease marker.
- `app.config.ts` owns bundle identifiers, application identifiers, entitlements, plugins, runtime policy, release-build transport restrictions, and derives the store-compatible numeric native version from `package.json`.
- `eas.json` owns repeatable development, preview, and production build profiles.
- `../server/openapi.yaml` owns the generated API schema in `src/api/generated/schema.ts`.
- `../web/src/i18n/locales` owns shared translation catalogs; `npm run i18n:sync` validates and copies them into the mobile catalog and regenerates Metro's static locale registry.
- `ios/` and `android/` are generated and ignored. Make durable native changes through Expo config, config plugins, `widgets/`, or `modules/`, then regenerate with `npm run prebuild`.

## Add a shared locale

Add one `<code>.json` catalog to `../web/src/i18n/locales`, using a lowercase two- or three-letter code and a non-empty `_meta.languageName`. English (`en.json`) remains required. Then run `npm run i18n:sync` and commit the copied catalogs with `src/i18n/generated.ts`. Shared keys use the new catalog immediately; mobile-only keys fall back to English until localized mobile resources are added.

## Architecture map

```text
src/
├── api/            # profile-scoped API client, capabilities, generated contract
├── context/        # session, active profile, theme, app lock, live mobile runtime
├── data/           # SQLCipher schema and repositories
├── domain/         # profile, synchronization, and compatibility types
├── features/       # auth, bills, payments, calendar, analytics, collaboration, admin
├── native/         # reminders, background sync, exports, app lock, widget snapshots
├── navigation/     # five-tab, deep-link-aware adaptive navigation
└── services/       # alpha migration, outbox processing, conflict mapping

modules/
├── billmanager-passkeys/ # AuthenticationServices and Credential Manager adapter
└── billmanager-widget/   # Android Jetpack Glance widget adapter

widgets/                  # iOS WidgetKit/Expo Widgets implementation
```
