import React, { useEffect, useMemo, useState } from 'react';
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationLightTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { api } from '../api/client';
import TelemetryNoticeModal from '../components/TelemetryNoticeModal';
import { useAuth } from '../context/AuthContext';
import { useServerProfiles } from '../context/ServerProfileContext';
import { useTheme } from '../context/ThemeContext';
import UpgradeRequiredScreen from '../screens/UpgradeRequiredScreen';
import AuthFlowNavigator from './AuthFlowNavigator';
import MainTabs from './MainTabs';
import { linking } from './linking';
import { RootStackParamList } from './types';

export * from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('mobileCore.common.loadingBillManager')}
      style={[styles.loading, { backgroundColor: colors.background }]}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export default function AppNavigator() {
  const { isLoading, isAuthenticated } = useAuth();
  const { colors, isDark } = useTheme();
  const { compatibility } = useServerProfiles();
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const designPreview = process.env.EXPO_PUBLIC_DESIGN_PREVIEW === '1';
  const showAuthenticatedApplication = isAuthenticated || designPreview;

  const navigationTheme = useMemo(() => ({
    ...(isDark ? NavigationDarkTheme : NavigationLightTheme),
    colors: {
      ...(isDark ? NavigationDarkTheme.colors : NavigationLightTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.warning,
    },
  }), [colors, isDark]);

  useEffect(() => {
    const checkTelemetryNotice = async () => {
      if (!isAuthenticated || isLoading || designPreview) return;
      try {
        const response = await api.getTelemetryNotice();
        if (response.success && response.data?.show_notice) setShowTelemetryModal(true);
      } catch (error) {
        if (__DEV__) console.debug('Failed to check telemetry notice:', error);
      }
    };

    void checkTelemetryNotice();
  }, [designPreview, isAuthenticated, isLoading]);

  if (isLoading && !designPreview) return <LoadingScreen />;
  if (compatibility) return <UpgradeRequiredScreen />;

  return (
    <>
      <NavigationContainer linking={linking} theme={navigationTheme}>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
        >
          {showAuthenticatedApplication ? (
            <Stack.Screen name="Main" component={MainTabs} />
          ) : (
            <Stack.Screen name="Auth" component={AuthFlowNavigator} />
          )}
        </Stack.Navigator>
      </NavigationContainer>

      <TelemetryNoticeModal
        visible={showTelemetryModal}
        onClose={() => setShowTelemetryModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
