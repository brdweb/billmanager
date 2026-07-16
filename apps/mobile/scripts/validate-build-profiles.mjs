import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function loadConfig(development) {
  const output = execFileSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: '',
      BILLMANAGER_DEVELOPMENT_BUILD: development ? 'true' : 'false',
      NO_COLOR: '1',
    },
  });
  return JSON.parse(output);
}

function cleartextSetting(config) {
  const plugin = config.plugins.find((entry) => (
    Array.isArray(entry) && entry[0] === 'expo-build-properties'
  ));
  return plugin?.[1]?.android?.usesCleartextTraffic;
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

const production = loadConfig(false);
const development = loadConfig(true);
assertPolicy(production, false, 'Preview/release');
assertPolicy(development, true, 'Development');

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
}

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
for (const profile of ['development', 'development:device']) {
  if (eas.build?.[profile]?.env?.BILLMANAGER_DEVELOPMENT_BUILD !== 'true') {
    throw new Error(`${profile} must opt into the development-only cleartext policy.`);
  }
}
for (const profile of ['preview', 'preview:ios', 'production']) {
  if (eas.build?.[profile]?.env?.BILLMANAGER_DEVELOPMENT_BUILD !== 'false') {
    throw new Error(`${profile} must enforce HTTPS-only transport policy.`);
  }
}

console.log('Validated HTTPS-only preview/release profiles and development-only cleartext policy.');
