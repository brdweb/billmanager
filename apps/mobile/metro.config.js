const imageSize = require('image-size');
const { getDefaultConfig } = require('expo/metro-config');

// Metro reads repository assets with image-size while bundling. The upstream
// ICNS, HEIF, and JPEG XL parsers currently have unpatched infinite-loop
// advisories. BillManager does not use these formats, so disable their handlers
// before Metro can inspect asset contents. Remove this only after image-size has
// published and Metro has adopted a patched release.
imageSize.disableTypes(['heif', 'icns', 'jxl', 'jxl-stream']);

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker loads wa-sqlite as a WebAssembly asset. Keeping the
// extension in Metro's asset pipeline makes the browser design preview and
// offline-capability tests use the same encrypted repository implementation.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
