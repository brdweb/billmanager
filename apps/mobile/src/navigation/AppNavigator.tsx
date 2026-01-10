import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import TelemetryNoticeModal from '../components/TelemetryNoticeModal';
import { api } from '../api/client';
import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import BillsScreen from '../screens/BillsScreen';
import BillDetailScreen from '../screens/BillDetailScreen';
import AddBillScreen from '../screens/AddBillScreen';
import StatsScreen from '../screens/StatsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import UserManagementScreen from '../screens/UserManagementScreen';
import InvitationsScreen from '../screens/InvitationsScreen';
import DatabaseManagementScreen from '../screens/DatabaseManagementScreen';
import PaymentHistoryScreen from '../screens/PaymentHistoryScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import SharedBillsScreen from '../screens/SharedBillsScreen';
import { Bill } from '../types';

// Navigation types
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
};

export type MainTabParamList = {
  BillsStack: undefined;
  StatsStack: undefined;
  SettingsStack: undefined;
};

export type StatsStackParamList = {
  Stats: undefined;
  PaymentHistory: undefined;
  SharedBills: undefined;
};

export type BillsStackParamList = {
  BillsList: undefined;
  BillDetail: { billId: number };
  AddBill: { bill?: Bill } | undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  UserManagement: undefined;
  Invitations: undefined;
  DatabaseManagement: undefined;
  Subscription: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const BillsStack = createNativeStackNavigator<BillsStackParamList>();
const StatsStackNav = createNativeStackNavigator<StatsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

// Auth stack navigator
function AuthStackNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

// Bills stack navigator
function BillsStackNavigator() {
  return (
    <BillsStack.Navigator screenOptions={{ headerShown: false }}>
      <BillsStack.Screen name="BillsList" component={BillsScreen} />
      <BillsStack.Screen name="BillDetail" component={BillDetailScreen} />
      <BillsStack.Screen name="AddBill" component={AddBillScreen} />
    </BillsStack.Navigator>
  );
}

// Stats stack navigator
function StatsStackNavigator() {
  return (
    <StatsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <StatsStackNav.Screen name="Stats" component={StatsScreen} />
      <StatsStackNav.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <StatsStackNav.Screen name="SharedBills" component={SharedBillsScreen} />
    </StatsStackNav.Navigator>
  );
}

// Settings stack navigator
function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator screenOptions={{ headerShown: false }}>
      <SettingsStack.Screen name="Settings" component={SettingsScreen} />
      <SettingsStack.Screen name="UserManagement" component={UserManagementScreen} />
      <SettingsStack.Screen name="Invitations" component={InvitationsScreen} />
      <SettingsStack.Screen name="DatabaseManagement" component={DatabaseManagementScreen} />
      <SettingsStack.Screen name="Subscription" component={SubscriptionScreen} />
    </SettingsStack.Navigator>
  );
}

// Main app tabs
function MainTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Calculate tab bar height based on safe area
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabBarLabel,
      })}
    >
      <Tab.Screen
        name="BillsStack"
        component={BillsStackNavigator}
        options={{
          tabBarLabel: 'Bills',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.iconPlaceholder}>
              <View style={[styles.iconSquare, { borderColor: color }]} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="StatsStack"
        component={StatsStackNavigator}
        options={{
          tabBarLabel: 'Stats',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.iconPlaceholder}>
              <View style={[styles.iconChart, { borderColor: color }]} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="SettingsStack"
        component={SettingsStackNavigator}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.iconPlaceholder}>
              <View style={[styles.iconCircle, { borderColor: color }]} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Loading screen
function LoadingScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// Main navigator
export default function AppNavigator() {
  const { isLoading, isAuthenticated } = useAuth();
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);

  // Check telemetry notice status when authenticated
  useEffect(() => {
    const checkTelemetryNotice = async () => {
      if (!isAuthenticated || isLoading) return;

      try {
        const response = await api.getTelemetryNotice();
        if (response.success && response.data?.show_notice) {
          setShowTelemetryModal(true);
        }
      } catch (error) {
        // Silently fail - telemetry notice is not critical
        console.debug('Failed to check telemetry notice:', error);
      }
    };

    checkTelemetryNotice();
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isAuthenticated ? (
            <Stack.Screen name="Main" component={MainTabs} />
          ) : (
            <Stack.Screen name="Auth" component={AuthStackNavigator} />
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  tabBar: {
    backgroundColor: '#16213e',
    borderTopColor: '#0f3460',
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
    paddingTop: 8,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  iconPlaceholder: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSquare: {
    width: 20,
    height: 16,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#888',
  },
  iconSquareFocused: {
    borderColor: '#e94560',
  },
  iconChart: {
    width: 20,
    height: 16,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#888',
    borderTopWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  iconCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#888',
  },
  iconCircleFocused: {
    borderColor: '#e94560',
  },
});
