const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite web support needs to resolve wa-sqlite.wasm as an asset
config.resolver.assetExts.push('wasm');

module.exports = config;
