import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import * as Sentry from '@sentry/react-native';

import App from './App';
import { initializeSentry } from './src/telemetry/sentry';

const sentryEnabled = initializeSentry();

// Ignore specific warnings
LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
]);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(sentryEnabled ? Sentry.wrap(App) : App);
