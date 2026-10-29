const fs = require('fs');
const path = require('path');

function installProductHook(root) {
  const appDir = path.join(root, 'android/app');
  const gradlePath = path.join(appDir, 'build.gradle');
  if (!fs.existsSync(gradlePath)) throw new Error('Run npm run android:prepare before building an APK.');
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  const marker = /\n?\/\/ @alraqi-google-services-start[\s\S]*?\/\/ @alraqi-google-services-end\n?/g;
  gradle = gradle.replace(marker, '\n')
    .replace(/^apply plugin:\s*["']com\.google\.gms\.google-services["']\s*$/gm, '')
    .replace(/^apply from:\s*["']\.\.\/\.\.\/native\/operations\.gradle["']\s*$/gm, '').trimEnd();
  gradle += `

apply from: "../../native/operations.gradle"
// @alraqi-google-services-start
// Private Firebase registration is optional for source verification builds.
def alraqiFirebaseFile = project.findProperty('alraqiApp') == 'operations'
    ? file('../../config/operations/google-services.json') : file('../../google-services.json')
if (alraqiFirebaseFile.exists()) {
    apply plugin: "com.google.gms.google-services"
    afterEvaluate {
        tasks.matching { it.name.endsWith('GoogleServices') }.configureEach {
            googleServicesJsonFiles.set([alraqiFirebaseFile])
        }
    }
}
// @alraqi-google-services-end
`;
  fs.writeFileSync(gradlePath, gradle);

  const hasFirebase = ['google-services.json', 'config/operations/google-services.json'].some(name => fs.existsSync(path.join(root, name)));
  if (hasFirebase) {
    const buildPath = path.join(root, 'android/build.gradle');
    let build = fs.readFileSync(buildPath, 'utf8');
    if (!build.includes('com.google.gms:google-services:')) {
      if (!/dependencies\s*\{/.test(build)) throw new Error('Android buildscript dependency block was not found.');
      build = build.replace(/dependencies\s*\{/, "dependencies {\n        classpath('com.google.gms:google-services:4.4.4')");
      fs.writeFileSync(buildPath, build);
    }
  }

  const manifestPath = path.join(appDir, 'src/main/AndroidManifest.xml');
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace('android:label="@string/app_name"', 'android:label="${alraqiAppLabel}"')
    .replace('android:scheme="albinaa"', 'android:scheme="${alraqiScheme}"')
    .replace('android:icon="@mipmap/ic_launcher"', 'android:icon="${alraqiIcon}"')
    .replace('android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="${alraqiRoundIcon}"');
  fs.writeFileSync(manifestPath, manifest);

  const javaDir = path.join(appDir, 'src/main/java');
  const bridgeDir = path.join(javaDir, 'com/albinaa/collector');
  fs.mkdirSync(bridgeDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'native/android/StatementSharePackage.kt'), path.join(bridgeDir, 'StatementSharePackage.kt'));
  const apps = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name === 'MainApplication.kt') apps.push(file);
    }
  }
  visit(javaDir);
  if (apps.length !== 1) throw new Error('Expected one generated MainApplication.kt.');
  let app = fs.readFileSync(apps[0], 'utf8');
  if (!/add\((?:com\.albinaa\.collector\.)?StatementSharePackage\(\)\)/.test(app)) {
    const anchor = 'PackageList(this).packages.apply {';
    if (!app.includes(anchor)) throw new Error('Native package registration block was not found.');
    app = app.replace(anchor, anchor + '\n            add(com.albinaa.collector.StatementSharePackage())');
    fs.writeFileSync(apps[0], app);
  }
}

module.exports = { installProductHook };
