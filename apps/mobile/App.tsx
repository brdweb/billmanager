import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import './src/i18n';
import { BiometricGate } from './src/components/BiometricGate';
import { SecurityConfirmation } from './src/components/SecurityConfirmation';
import { AppLockProvider } from './src/context/AppLockContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SessionQueryProvider } from './src/context/SessionQueryProvider';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ConfigProvider } from './src/context/ConfigContext';
import { MobileRuntimeProvider } from './src/context/MobileRuntimeContext';
import { ServerProfileProvider, useServerProfiles } from './src/context/ServerProfileContext';
import AppNavigator from './src/navigation/AppNavigator';

function AuthenticatedApplication() {
  const { user, isAuthenticated } = useAuth();
  const { activeProfile } = useServerProfiles();
  // A new cache and runtime also invalidate old native-surface leases. Even a
  // same-user sign-in after logout starts a new mounted session boundary.
  const sessionKey = `${activeProfile.id}:${isAuthenticated ? `user:${user?.id}` : 'anonymous'}`;
  return (
    <SessionQueryProvider sessionKey={sessionKey}>
      <ConfigProvider>
        <MobileRuntimeProvider>
          <AppLockProvider>
            <BiometricGate><AppContent /></BiometricGate>
          </AppLockProvider>
        </MobileRuntimeProvider>
      </ConfigProvider>
    </SessionQueryProvider>
  );
}

function AppContent() {
  const { isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      <SecurityConfirmation />
    </>
  );
}

function ProfileBoundApplication() {
  const { activeProfile } = useServerProfiles();

  return (
    <AuthProvider key={activeProfile.id}>
      <AuthenticatedApplication />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <ServerProfileProvider>
          <ThemeProvider>
            <ProfileBoundApplication />
          </ThemeProvider>
        </ServerProfileProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
