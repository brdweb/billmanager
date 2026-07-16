import Constants from 'expo-constants';
import React from 'react';
import {
  BarChart3,
  ChevronRight,
  CircleUserRound,
  CreditCard,
  Database,
  Globe2,
  Info,
  KeyRound,
  Languages,
  Layers3,
  Link2,
  LogOut,
  Palette,
  Server,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import AdaptiveHeader from '../../components/adaptive/AdaptiveHeader';
import AdaptiveListRow from '../../components/adaptive/AdaptiveListRow';
import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import { useAuth } from '../../context/AuthContext';
import { useAppLock } from '../../context/AppLockContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { useTheme } from '../../context/ThemeContext';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import { getFormattingConfig } from '../../i18n/format';
import { normalizeLanguage } from '../../i18n';

interface SettingsHomeScreenViewProps {
  platform: AdaptivePlatform;
}

interface SettingsGroupProps {
  platform: AdaptivePlatform;
  title: string;
  children: React.ReactNode;
}

function SettingsGroup({ platform, title, children }: SettingsGroupProps) {
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={styles.group}>
      <Text
        accessibilityRole="header"
        style={[
          platform === 'ios' ? styles.iosGroupTitle : typography.section,
          { color: platform === 'ios' ? theme.colors.textMuted : theme.colors.text },
        ]}
      >
        {platform === 'ios' ? title.toUpperCase() : title}
      </Text>
      <AdaptiveSurface>{children}</AdaptiveSurface>
    </View>
  );
}

function SettingIcon({
  platform,
  children,
  accent = false,
}: {
  platform: AdaptivePlatform;
  children: React.ReactNode;
  accent?: boolean;
}) {
  const theme = useAdaptiveTheme(platform);
  return (
    <View
      style={[
        styles.settingIcon,
        { backgroundColor: accent ? theme.colors.accentContainer : theme.colors.surfaceMuted },
      ]}
    >
      {children}
    </View>
  );
}

export function SettingsHomeScreenView({ platform }: SettingsHomeScreenViewProps) {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  const { user, logout } = useAuth();
  const { themeMode } = useTheme();
  const { activeProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const appLock = useAppLock();
  const formatting = getFormattingConfig();
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const appVersion = typeof Constants.expoConfig?.extra?.releaseVersion === 'string'
    ? Constants.expoConfig.extra.releaseVersion
    : Constants.expoConfig?.version ?? '1.0.0';
  const appearanceLabel = t('mobileSettings.appearance.' + themeMode);
  const deploymentLabel = activeProfile.deploymentMode === 'saas'
    ? t('mobileSettings.home.cloud')
    : activeProfile.deploymentMode === 'development'
      ? t('mobileSettings.home.development')
      : t('mobileSettings.home.selfHosted');
  const canAdminister = user?.role === 'admin' && Boolean(activeProfile.capabilities?.administration);
  const canManageBilling = Boolean(user?.is_account_owner && activeProfile.capabilities?.billing);

  const confirmLogout = () => {
    Alert.alert(t('mobileSettings.home.logOutTitle'), t('mobileSettings.home.logOutBody'), [
      { text: t('mobileSettings.home.cancel'), style: 'cancel' },
      { text: t('mobileSettings.home.logOut'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {platform === 'android' ? (
        <AdaptiveHeader
          title={t('mobileSettings.title')}
          notificationCount={runtime.bills.filter((bill) => bill.reminder_enabled).length}
          onPressNotifications={() => navigation.navigate('ReminderInbox')}
        />
      ) : null}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: layout.horizontalPadding, paddingBottom: 44 },
        ]}
      >
        <View style={[styles.content, { maxWidth: theme.contentMaxWidth }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileSettings.home.accountA11y', {
              name: user?.username ?? t('mobileSettings.home.accountFallback'),
            })}
            onPress={() => navigation.navigate('LegacySettings')}
            style={({ pressed }) => [
              styles.profileCard,
              {
                backgroundColor: platform === 'ios' ? theme.colors.surface : theme.colors.primaryContainer,
                borderColor: theme.colors.border,
                borderRadius: platform === 'ios' ? 14 : 24,
                opacity: pressed ? 0.62 : 1,
              },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
              <CircleUserRound size={30} color={theme.colors.onPrimary} />
            </View>
            <View style={styles.profileCopy}>
              <Text style={[typography.section, { color: theme.colors.text }]}>
                {user?.username ?? t('mobileSettings.home.accountFallback')}
              </Text>
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                {user?.email ?? activeProfile.displayName} • {user?.role === 'admin'
                  ? t('mobileSettings.home.administrator')
                  : t('mobileSettings.home.member')}
              </Text>
            </View>
            <ChevronRight size={21} color={theme.colors.textMuted} />
          </Pressable>

          <View style={[layout.isTablet && styles.tabletColumns, { gap: layout.columnGap }]}>
            <View style={layout.isTablet && styles.column}>
              <SettingsGroup platform={platform} title={t('mobileSettings.groups.preferences')}>
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.languageRegion')}
                  subtitle={(language === 'de'
                    ? t('mobileSettings.language.german')
                    : t('mobileSettings.language.english')) + ' • ' + formatting.currency}
                  leading={<SettingIcon platform={platform}><Languages size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('LanguageRegion')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.appearance')}
                  subtitle={appearanceLabel}
                  leading={<SettingIcon platform={platform}><Palette size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('Appearance')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.billGroups')}
                  subtitle={t('mobileSettings.home.billGroupsDetail')}
                  leading={<SettingIcon platform={platform}><Layers3 size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('DatabaseManagement')}
                  isLast
                />
              </SettingsGroup>

              <SettingsGroup platform={platform} title={t('mobileSettings.groups.security')}>
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.security')}
                  subtitle={(appLock.enabled
                    ? t('mobileSettings.home.appLockOn')
                    : t('mobileSettings.home.appLockOff')) + ' • ' + t('mobileSettings.home.securityDetail')}
                  leading={<SettingIcon platform={platform}><ShieldCheck size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('SecurityOverview')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.linkedAccounts')}
                  subtitle={t('mobileSettings.home.linkedAccountsDetail')}
                  leading={<SettingIcon platform={platform}><Link2 size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('LinkedAccounts')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.password')}
                  subtitle={t('mobileSettings.home.passwordDetail')}
                  leading={<SettingIcon platform={platform}><KeyRound size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('LegacySettings')}
                  isLast
                />
              </SettingsGroup>
            </View>

            <View style={layout.isTablet && styles.column}>
              <SettingsGroup platform={platform} title={t('mobileSettings.groups.connection')}>
                <AdaptiveListRow
                  platform={platform}
                  title={activeProfile.displayName}
                  subtitle={deploymentLabel + ' • ' + (activeProfile.lastVerifiedAt
                    ? t('mobileSettings.home.verified')
                    : t('mobileSettings.home.verificationRequired'))}
                  leading={<SettingIcon platform={platform}><Server size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('ServerProfiles')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.offlineStorage')}
                  subtitle={t('mobileSettings.home.conflicts', {
                    count: runtime.conflicts.length,
                  }) + ' • ' + (runtime.online
                    ? runtime.syncing
                      ? t('mobileSettings.home.syncing')
                      : t('mobileSettings.home.connected')
                    : t('mobileSettings.home.offline'))}
                  leading={<SettingIcon platform={platform}><Database size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('OfflineQueue')}
                  isLast
                />
              </SettingsGroup>

              {canAdminister || canManageBilling ? (
                <SettingsGroup platform={platform} title={t('mobileSettings.groups.administration')}>
                  {canAdminister ? (
                    <>
                      <AdaptiveListRow
                        platform={platform}
                        title={t('mobileSettings.home.users')}
                        subtitle={t('mobileSettings.home.usersDetail')}
                        leading={<SettingIcon platform={platform}><Users size={21} color={theme.colors.primary} /></SettingIcon>}
                        onPress={() => navigation.navigate('Administration')}
                      />
                      <AdaptiveListRow
                        platform={platform}
                        title={t('mobileSettings.home.invitations')}
                        subtitle={t('mobileSettings.home.invitationsDetail')}
                        leading={<SettingIcon platform={platform}><UserPlus size={21} color={theme.colors.primary} /></SettingIcon>}
                        onPress={() => navigation.navigate('Invitations')}
                        isLast={!canManageBilling}
                      />
                    </>
                  ) : null}
                  {canManageBilling ? (
                    <AdaptiveListRow
                      platform={platform}
                      title={t('mobileSettings.home.billing')}
                      subtitle={t('mobileSettings.home.billingDetail')}
                      leading={<SettingIcon platform={platform}><CreditCard size={21} color={theme.colors.primary} /></SettingIcon>}
                      onPress={() => navigation.navigate('Billing')}
                      isLast
                    />
                  ) : null}
                </SettingsGroup>
              ) : null}

              <SettingsGroup platform={platform} title={t('mobileSettings.groups.about')}>
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.telemetry')}
                  subtitle={t('mobileSettings.home.telemetryDetail')}
                  leading={<SettingIcon platform={platform}><BarChart3 size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('Telemetry')}
                />
                <AdaptiveListRow
                  platform={platform}
                  title={t('mobileSettings.home.releaseNotes')}
                  subtitle={'BillManager Mobile ' + appVersion}
                  leading={<SettingIcon platform={platform}><Info size={21} color={theme.colors.primary} /></SettingIcon>}
                  onPress={() => navigation.navigate('ReleaseNotes')}
                  isLast
                />
              </SettingsGroup>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileSettings.home.logOut')}
            onPress={confirmLogout}
            style={({ pressed }) => [
              styles.logout,
              {
                minHeight: theme.minimumHitSize,
                borderColor: theme.colors.danger,
                opacity: pressed ? 0.58 : 1,
              },
            ]}
          >
            <LogOut size={20} color={theme.colors.danger} />
            <Text style={[typography.callout, { color: theme.colors.danger, fontWeight: '700' }]}>
              {t('mobileSettings.home.logOut')}
            </Text>
          </Pressable>

          <View style={styles.versionRow}>
            <Globe2 size={15} color={theme.colors.textMuted} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
              {t('mobileSettings.home.versionLabel', { version: appVersion })}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingTop: 20 },
  content: { width: '100%', alignSelf: 'center', gap: 22 },
  profileCard: {
    minHeight: 86,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  avatar: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  profileCopy: { minWidth: 0, flex: 1, gap: 2 },
  group: { gap: 8, marginBottom: 20 },
  iosGroupTitle: { marginLeft: 14, fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0.15 },
  settingIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabletColumns: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1 },
  logout: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  versionRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
});
