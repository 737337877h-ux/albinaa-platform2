const { withAndroidManifest, withAndroidStyles } = require('@expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    if (manifest.manifest && manifest.manifest.application) {
      manifest.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });

  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style || [];
    const appTheme = styles.find((style) => style.$?.name === 'AppTheme');
    if (!appTheme) return config;

    const names = new Set([
      'android:navigationBarColor',
      'android:windowLightNavigationBar',
      'android:enforceNavigationBarContrast',
    ]);
    appTheme.item = (appTheme.item || []).filter((item) => !names.has(item.$?.name));
    appTheme.item.push(
      { $: { name: 'android:navigationBarColor' }, _: '#004D40' },
      { $: { name: 'android:windowLightNavigationBar' }, _: 'false' },
      { $: { name: 'android:enforceNavigationBarContrast' }, _: 'false' },
    );
    return config;
  });
};
