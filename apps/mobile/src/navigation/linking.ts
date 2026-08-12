import { LinkingOptions } from '@react-navigation/native';

import { shouldHandleOAuthUrlWithNavigation } from '../features/auth/oauthBrowser';
import { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['billmanager://', 'https://app.billmanager.app'],
  filter: shouldHandleOAuthUrlWithNavigation,
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
          VerifyEmail: 'verify-email',
          ResendVerification: 'resend-verification',
          ForgotPassword: 'forgot-password',
          ResetPassword: 'reset-password',
          ForcedPasswordChange: 'change-password',
          AcceptInvite: 'accept-invite',
          AcceptShareInvite: 'accept-share-invite',
          OAuthProviders: 'auth/providers',
          OAuthCallback: 'auth/callback',
          TwoFactorChallenge: 'auth/two-factor',
        },
      },
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Home: 'home',
              ReminderInbox: 'reminders',
              AddBill: 'home/new-bill',
            },
          },
          BillsTab: {
            screens: {
              BillsHome: 'bills',
              BillsList: 'bills/live',
              BillDetail: {
                path: 'bills/:billId',
                parse: { billId: Number },
              },
              AddBill: 'bills/new',
              ReminderInbox: 'bills/reminders',
            },
          },
          CalendarTab: {
            screens: {
              CalendarHome: 'calendar',
              AddBill: 'calendar/new-bill',
              ReminderInbox: 'calendar/reminders',
            },
          },
          InsightsTab: {
            screens: {
              InsightsHome: 'insights',
              Stats: 'insights/analytics',
              PaymentHistory: 'payments',
              Analytics: 'analytics',
              Settlements: 'settlements',
              Collaboration: 'collaboration',
              SharedBills: 'shared-bills',
              ReminderInbox: 'insights/reminders',
            },
          },
          SettingsTab: {
            screens: {
              SettingsHome: 'settings',
              LanguageRegion: 'settings/language-region',
              Appearance: 'settings/appearance',
              Telemetry: 'settings/privacy',
              ReleaseNotes: 'settings/release-notes',
              LegacySettings: 'settings/preferences',
              UserManagement: 'settings/users',
              Invitations: 'settings/invitations',
              DatabaseManagement: 'settings/bill-groups',
              Subscription: 'settings/subscription',
              ServerProfiles: 'settings/servers',
              OfflineQueue: 'settings/offline',
              AppSecurity: 'settings/device-security',
              SecurityOverview: 'settings/security',
              LinkedAccounts: 'settings/security/linked-accounts',
              OAuthLink: 'settings/security/linked-accounts/new',
              TwoFactorSettings: 'settings/security/two-factor',
              EmailTwoFactorSetup: 'settings/security/two-factor/email',
              PasskeyManagement: 'settings/security/passkeys',
              RecoveryCodes: 'settings/security/recovery-codes',
              DisableTwoFactor: 'settings/security/disable-two-factor',
              DeleteAccount: 'settings/security/delete-account',
              Administration: 'settings/administration',
              Billing: 'settings/billing',
              ReminderInbox: 'settings/reminders',
            },
          },
        },
      },
    },
  },
};
