const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker loads wa-sqlite as a WebAssembly asset. Keeping the
// extension in Metro's asset pipeline makes the browser design preview and
// offline-capability tests use the same encrypted repository implementation.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
