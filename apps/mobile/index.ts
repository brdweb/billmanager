import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import App from './App';

// Ignore specific warnings
LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
]);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
