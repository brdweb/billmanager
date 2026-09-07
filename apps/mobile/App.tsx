import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './src/i18n';
import { BiometricGate } from './src/components/BiometricGate';
import { SecurityConfirmation } from './src/components/SecurityConfirmation';
import { AppLockProvider } from './src/context/AppLockContext';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ConfigProvider } from './src/context/ConfigContext';
import { MobileRuntimeProvider } from './src/context/MobileRuntimeContext';
import { ServerProfileProvider, useServerProfiles } from './src/context/ServerProfileContext';
import AppNavigator from './src/navigation/AppNavigator';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      retry: 2,
      staleTime: 30_000,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 0,
    },
  },
});

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
      <ConfigProvider>
        <MobileRuntimeProvider>
          <AppLockProvider>
            <BiometricGate>
              <AppContent />
            </BiometricGate>
          </AppLockProvider>
        </MobileRuntimeProvider>
      </ConfigProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ServerProfileProvider>
            <ThemeProvider>
              <ProfileBoundApplication />
            </ThemeProvider>
          </ServerProfileProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
