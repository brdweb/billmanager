import { Bill } from '../types';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  ServerProfiles: undefined;
  Register: undefined;
  VerifyEmail: { token: string };
  ResendVerification: { email?: string } | undefined;
  ForgotPassword: undefined;
  ResetPassword: { token: string };
  ForcedPasswordChange: {
    token: string;
    scope: import('../features/auth').AuthSessionScope;
  };
  AcceptInvite: { token: string };
  AcceptShareInvite: { token: string };
  OAuthProviders: { flow?: 'login' | 'link' } | undefined;
  OAuthCallback: {
    provider?: string;
    code: string;
    state: string;
    redirectUri?: string;
    flow?: 'login' | 'link';
  };
  TwoFactorChallenge: {
    sessionToken: string;
    methods: import('../features/auth').TwoFactorMethod[];
    scope: import('../features/auth').AuthSessionScope;
  };
};

export type MainTabParamList = {
  HomeTab: undefined;
  BillsTab: undefined;
  CalendarTab: undefined;
  InsightsTab: undefined;
  SettingsTab: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  ReminderInbox: undefined;
  AddBill: { bill?: Bill } | undefined;
};

export type BillsStackParamList = {
  BillsHome: undefined;
  BillsList: undefined;
  BillDetail: { billId: number };
  AddBill: { bill?: Bill } | undefined;
  ReminderInbox: undefined;
};

export type CalendarStackParamList = {
  CalendarHome: undefined;
  AddBill: { bill?: Bill } | undefined;
  ReminderInbox: undefined;
};

export type InsightsStackParamList = {
  InsightsHome: undefined;
  Stats: undefined;
  PaymentHistory: undefined;
  Analytics: undefined;
  Settlements: undefined;
  Collaboration: undefined;
  SharedBills: undefined;
  ReminderInbox: undefined;
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  LanguageRegion: undefined;
  Appearance: undefined;
  Telemetry: undefined;
  ReleaseNotes: undefined;
  LegacySettings: undefined;
  UserManagement: undefined;
  Invitations: undefined;
  DatabaseManagement: undefined;
  Subscription: undefined;
  ServerProfiles: undefined;
  OfflineQueue: undefined;
  AppSecurity: undefined;
  SecurityOverview: undefined;
  LinkedAccounts: undefined;
  OAuthLink: undefined;
  TwoFactorSettings: undefined;
  EmailTwoFactorSetup: undefined;
  PasskeyManagement: undefined;
  RecoveryCodes: { codes?: string[] } | undefined;
  DisableTwoFactor: undefined;
  DeleteAccount: undefined;
  Administration: undefined;
  Billing: undefined;
  ReminderInbox: undefined;
};
