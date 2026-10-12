const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Sentry's Metro serializer injects debug IDs into native bundles and source maps.
// Disable web replay resolution and development source-context middleware because
// BillManager only uses Sentry for minimal crash reporting.
const config = getSentryExpoConfig(__dirname, {
  includeWebReplay: false,
  enableSourceContextInDevelopment: false,
});

// expo-sqlite's web worker loads wa-sqlite as a WebAssembly asset. Keeping the
// extension in Metro's asset pipeline makes the browser design preview and
// offline-capability tests use the same encrypted repository implementation.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
