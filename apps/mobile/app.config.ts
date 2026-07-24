import type { ExpoConfig, ConfigContext } from 'expo/config';

// package.json is the single source for the semantic mobile release version.
// Native store versions must stay numeric, so pre-release metadata is exposed
// separately to JavaScript while the generated native version uses its core.
const packageJson = require('./package.json') as { version: string };
const MOBILE_RELEASE_VERSION = packageJson.version;
const NATIVE_APP_VERSION = MOBILE_RELEASE_VERSION.split('-', 1)[0] || MOBILE_RELEASE_VERSION;

function releaseLabel(version: string): string | undefined {
  const prerelease = version.split('-', 2)[1];
  if (!prerelease) return undefined;
  const alpha = prerelease.match(/^alpha[.-]?(\d+)$/i);
  return alpha ? `Alpha-${alpha[1]}` : prerelease;
}

const MOBILE_RELEASE_LABEL = releaseLabel(MOBILE_RELEASE_VERSION);

const EAS_PROJECT_ID = '061766ea-b874-4027-bcbb-a24b395cb8b6';
const IOS_BUNDLE_ID = 'com.brdweb.billmanager';
const ANDROID_PACKAGE = 'com.brdweb.billmanagermobile';
const IOS_PASSKEY_DOMAINS = Array.from(new Set([
  'app.billmanager.app',
  ...(process.env.BILLMANAGER_IOS_PASSKEY_DOMAINS ?? '')
    .split(',')
    .map((domain: string) => domain.trim().toLowerCase())
    .filter((domain: string) => /^[a-z0-9.-]+$/.test(domain)),
]));

export default ({ config }: ConfigContext): ExpoConfig => {
  const developmentBuild =
    process.env.EAS_BUILD_PROFILE === 'development' ||
    process.env.EAS_BUILD_PROFILE === 'development:device' ||
    process.env.BILLMANAGER_DEVELOPMENT_BUILD === 'true';

  return {
    ...config,
    name: 'BillManager',
    slug: 'billmanager-mobile',
    owner: 'brdweb',
    version: NATIVE_APP_VERSION,
    orientation: 'default',
    icon: './assets/icon.png',
    scheme: 'billmanager',
    userInterfaceStyle: 'automatic',
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: IOS_BUNDLE_ID,
      buildNumber: '1',
      associatedDomains: [
        'applinks:app.billmanager.app',
        ...IOS_PASSKEY_DOMAINS.map((domain) => `webcredentials:${domain}`),
      ],
      entitlements: {
        'com.apple.security.application-groups': [`group.${IOS_BUNDLE_ID}`],
      },
      infoPlist: {
        BillManagerPasskeyRPDomains: IOS_PASSKEY_DOMAINS,
        NSAppTransportSecurity: developmentBuild
          ? {
              NSAllowsArbitraryLoads: true,
              NSAllowsLocalNetworking: true,
            }
          : {
              NSAllowsArbitraryLoads: false,
              NSAllowsLocalNetworking: false,
            },
      },
    },
    android: {
      package: ANDROID_PACKAGE,
      // Keep this above the highest previously distributed Android build so
      // preview APKs can be installed as updates on test devices.
      versionCode: 6,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#005a45',
      },
      predictiveBackGestureEnabled: true,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [
            {
              scheme: 'https',
              host: 'app.billmanager.app',
              pathPrefix: '/',
            },
          ],
        },
      ],
    },
    web: {
      bundler: 'metro',
      favicon: './assets/favicon.png',
    },
    plugins: [
      [
        'expo-secure-store',
        {
          configureAndroidBackup: false,
          faceIDPermission: 'Allow BillManager to protect your financial information with Face ID.',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Allow BillManager to unlock with Face ID.',
        },
      ],
      [
        'expo-notifications',
        {
          color: '#00875a',
          defaultChannel: 'bill-reminders',
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: '#005a45',
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
        },
      ],
      [
        'expo-sqlite',
        {
          enableFTS: true,
          useSQLCipher: true,
        },
      ],
      [
        'expo-widgets',
        {
          bundleIdentifier: `${IOS_BUNDLE_ID}.widgets`,
          groupIdentifier: `group.${IOS_BUNDLE_ID}`,
          widgets: [
            {
              name: 'BillManagerUpcoming',
              displayName: 'BillManager Upcoming',
              description: 'See what is due next without opening BillManager.',
              supportedFamilies: ['systemSmall', 'systemMedium', 'systemLarge'],
            },
          ],
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: developmentBuild,
          },
        },
      ],
      'expo-localization',
      'expo-sharing',
      'expo-background-task',
      'expo-web-browser',
      'expo-updates',
      'expo-font',
    ],
    extra: {
      ...config.extra,
      allowCleartextDevelopmentServers: developmentBuild,
      releaseVersion: MOBILE_RELEASE_VERSION,
      releaseLabel: MOBILE_RELEASE_LABEL,
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
  };
};
