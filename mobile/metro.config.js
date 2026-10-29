const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ZXing's official scanner confirmation sound is distributed as OGG.
// Keep the original file instead of replacing it with the app notification tone.
if (!config.resolver.assetExts.includes('ogg')) config.resolver.assetExts.push('ogg');

module.exports = config;
