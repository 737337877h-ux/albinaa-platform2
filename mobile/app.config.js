const fs = require('fs');
const path = require('path');

// Collector stays the default. Both APKs share source, not Android storage.
module.exports = ({ config }) => {
  if (process.env.ALRAQI_APP !== 'operations') {
    const firebase = path.join(__dirname, 'google-services.json');
    return { ...config, android: { ...config.android, googleServicesFile: fs.existsSync(firebase) ? firebase : undefined } };
  }
  const firebase = path.join(__dirname, 'config/operations/google-services.json');
  const projectId = process.env.ALRAQI_OPERATIONS_EAS_PROJECT_ID || '5b5fc67c-1077-4ffd-86b7-80dfd5aaae7c';
  return {
    ...config,
    name: 'الراقي إدارة العملاء والمخزون',
    slug: 'alraqi-operations',
    version: '1.0.9',
    icon: './assets/operations-logo.png',
    plugins: (config.plugins || []).map(plugin => {
      const [name, options] = Array.isArray(plugin) ? plugin : [plugin, {}];
      return name === 'expo-notifications' ? [name, { ...options, sounds: ['./native/operations-res/raw/alraqi_sms.m4a'] }] : plugin;
    }),
    scheme: 'alraqi-operations',
    android: {
      ...config.android,
      package: 'com.alraqi.operations',
      versionCode: 10,
      adaptiveIcon: { foregroundImage: './assets/operations-logo.png', backgroundColor: '#F7F7F7' },
      googleServicesFile: fs.existsSync(firebase) ? firebase : undefined,
    },
    ios: { ...config.ios, bundleIdentifier: 'com.alraqi.operations' },
    extra: {
      ...config.extra,
      applicationVariant: 'operations',
      operationsPushConfigured: Boolean(fs.existsSync(firebase) && projectId),
      eas: projectId ? { projectId } : undefined,
    },
  };
};
