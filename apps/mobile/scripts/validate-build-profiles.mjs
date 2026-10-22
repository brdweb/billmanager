import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadConfig({ development, profile = '' }) {
  const output = execFileSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: profile,
      BILLMANAGER_DEVELOPMENT_BUILD: development ? 'true' : 'false',
      NO_COLOR: '1',
    },
  });
  return JSON.parse(output);
}

function loadIntrospectedProductionConfig() {
  const output = execFileSync(npx, ['expo', 'config', '--type', 'introspect', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: 'production',
      BILLMANAGER_DEVELOPMENT_BUILD: 'false',
      NO_COLOR: '1',
    },
  });
  return JSON.parse(output);
}

function cleartextSetting(config) {
  return buildProperties(config)?.usesCleartextTraffic;
}

function buildProperties(config) {
  const plugin = config.plugins.find((entry) => (
    Array.isArray(entry) && entry[0] === 'expo-build-properties'
  ));
  return plugin?.[1]?.android;
}

function sentryPlugin(config) {
  return config.plugins.find((entry) => (
    Array.isArray(entry) && entry[0] === '@sentry/react-native/expo'
  ));
}

function assertPolicy(config, expected, label) {
  const ats = config.ios?.infoPlist?.NSAppTransportSecurity;
  const actual = {
    android: cleartextSetting(config),
    iosArbitrary: ats?.NSAllowsArbitraryLoads,
    iosLocal: ats?.NSAllowsLocalNetworking,
    runtime: config.extra?.allowCleartextDevelopmentServers,
  };
  for (const [surface, value] of Object.entries(actual)) {
    if (value !== expected) {
      throw new Error(`${label} ${surface} cleartext policy is ${String(value)}; expected ${expected}.`);
    }
  }
}

const production = loadConfig({ development: false, profile: 'production' });
const preview = loadConfig({ development: false, profile: 'preview' });
const iosPreview = loadConfig({ development: false, profile: 'preview:ios' });
const development = loadConfig({ development: true, profile: 'development' });
const introspectedProduction = loadIntrospectedProductionConfig();
assertPolicy(production, false, 'Preview/release');
assertPolicy(development, true, 'Development');

for (const [label, config] of Object.entries({ production, preview, iosPreview, development })) {
  if (Object.hasOwn(config.extra ?? {}, 'sentryTestCrashEnabled')) {
    throw new Error(`${label} must not contain the removed Sentry native-crash harness.`);
  }
}

const iosEntitlements = introspectedProduction._internal?.modResults?.ios?.entitlements;
if (!iosEntitlements || Object.hasOwn(iosEntitlements, 'aps-environment')) {
  throw new Error('Production iOS builds must not declare the unused remote-push entitlement.');
}

const requiredAndroidBuild = {
  compileSdkVersion: 37,
  targetSdkVersion: 36,
  buildToolsVersion: '37.0.0',
};
for (const [label, config] of Object.entries({ production, development })) {
  const pluginNames = config.plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
  if (!pluginNames.includes('./plugins/withReleaseLintDisabled')) {
    throw new Error(`${label} must disable Android release lint vital so EAS medium workers can assembleRelease.`);
  }
  const actual = buildProperties(config);
  for (const [property, expected] of Object.entries(requiredAndroidBuild)) {
    if (actual?.[property] !== expected) {
      throw new Error(`${label} Android ${property} is ${String(actual?.[property])}; expected ${expected}.`);
    }
  }
}

const mobilePackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseVersion = mobilePackage.version;
const nativeVersion = releaseVersion.split('-', 1)[0] || releaseVersion;
const prerelease = releaseVersion.split('-', 2)[1];
const expectedReleaseLabel = prerelease?.replace(/^alpha[.-]?(\d+)$/i, 'Alpha-$1');
for (const [label, config] of Object.entries({ production, development })) {
  if (config.version !== nativeVersion) {
    throw new Error(`${label} native version is ${String(config.version)}; expected ${nativeVersion}.`);
  }
  if (config.extra?.releaseVersion !== releaseVersion) {
    throw new Error(`${label} release version is not synchronized with package.json.`);
  }
  if (config.extra?.releaseLabel !== expectedReleaseLabel) {
    throw new Error(`${label} release label is not derived from the package pre-release.`);
  }
  const sentryOptions = sentryPlugin(config)?.[1];
  if (
    sentryOptions?.organization !== 'jason-mitchell' ||
    sentryOptions?.project !== 'billmanager-mobile' ||
    sentryOptions?.url !== 'https://sentry.io/'
  ) {
    throw new Error(`${label} Sentry plugin must target jason-mitchell/billmanager-mobile.`);
  }
}

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const androidReleaseWorkflow = readFileSync(
  new URL('../../../.github/workflows/release-android.yml', import.meta.url),
  'utf8',
);
for (const requiredFragment of [
  'refs/heads/main | refs/tags/mobile-v*)',
  'environment: android-production',
  'EAS_BUILD_PROFILE: production',
  'run: node scripts/verify-sentry-eas-environment.mjs --environment production',
]) {
  if (!androidReleaseWorkflow.includes(requiredFragment)) {
    throw new Error(`Android release builds must retain protected production selection and metadata-only EAS preflights: ${requiredFragment}`);
  }
}
if (eas.cli?.appVersionSource !== 'remote') {
  throw new Error('Production store builds must use remote version codes for reliable auto-incrementing.');
}
const developmentProfiles = ['development', 'development:device'];
const releaseProfiles = ['preview', 'preview:ios', 'production'];
for (const profile of developmentProfiles) {
  if (eas.build?.[profile]?.env?.BILLMANAGER_DEVELOPMENT_BUILD !== 'true') {
    throw new Error(`${profile} must opt into the development-only cleartext policy.`);
  }
}
for (const profile of releaseProfiles) {
  if (eas.build?.[profile]?.env?.BILLMANAGER_DEVELOPMENT_BUILD !== 'false') {
    throw new Error(`${profile} must enforce HTTPS-only transport policy.`);
  }
}
for (const profile of [...developmentProfiles, ...releaseProfiles]) {
  if (Object.hasOwn(eas.build?.[profile]?.env ?? {}, 'BILLMANAGER_SENTRY_TEST_CRASH')) {
    throw new Error(`${profile} must not configure the removed Sentry native-crash harness.`);
  }
}
for (const profile of [...developmentProfiles, ...releaseProfiles]) {
  if (eas.build?.[profile]?.node !== '24.19.0') {
    throw new Error(`${profile} must use the supported Node.js 24.19.0 build runtime.`);
  }
}
if (eas.build?.production?.android?.buildType !== 'app-bundle') {
  throw new Error('The Android production profile must create a Google Play app bundle.');
}
if (
  eas.submit?.production?.android?.track !== 'internal' ||
  eas.submit?.production?.android?.releaseStatus !== 'draft'
) {
  throw new Error('Android submissions must default to a draft internal-test release.');
}

console.log('Validated API 37 compile / API 36 target Android app-bundle builds, Sentry upload target, safe draft submission, and transport policy.');
