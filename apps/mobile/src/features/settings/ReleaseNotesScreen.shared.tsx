import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import { buildMobileVersionInfo } from './settingsModel';
import {
  SettingsAction,
  SettingsBulletList,
  SettingsDetailPage,
  SettingsInfoRow,
  SettingsSection,
} from './SettingsDetailComponents';

export function ReleaseNotesScreenView({
  platform,
  onOpenServerProfiles,
}: {
  platform: AdaptivePlatform;
  onOpenServerProfiles: () => void;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const { activeProfile } = useServerProfiles();
  const version = buildMobileVersionInfo({
    appVersion: typeof Constants.expoConfig?.extra?.releaseVersion === 'string'
      ? Constants.expoConfig.extra.releaseVersion
      : Constants.expoConfig?.version,
    nativeBuild: Constants.nativeBuildVersion,
    runtimeVersion: Updates.runtimeVersion,
    channel: Updates.channel,
    serverVersion: activeProfile.capabilities?.serverVersion,
    contractVersion: activeProfile.capabilities?.mobileContractVersion,
  });
  const value = (input: string) => {
    if (input === 'development') return t('mobileSettings.releaseNotes.development');
    if (input === 'unavailable') return t('mobileSettings.releaseNotes.unavailable');
    return input;
  };

  const sections = [
    {
      id: 'experience',
      items: t('mobileSettings.releaseNotes.items.experience', {
        returnObjects: true,
      }) as unknown as readonly string[],
    },
    {
      id: 'offline',
      items: t('mobileSettings.releaseNotes.items.offline', {
        returnObjects: true,
      }) as unknown as readonly string[],
    },
    {
      id: 'security',
      items: t('mobileSettings.releaseNotes.items.security', {
        returnObjects: true,
      }) as unknown as readonly string[],
    },
  ] as const;

  return (
    <SettingsDetailPage platform={platform} intro={t('mobileSettings.releaseNotes.intro')}>
      <SettingsSection platform={platform} title={t('mobileSettings.releaseNotes.currentBuild')}>
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.appVersion')}
          value={version.appVersion}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.nativeBuild')}
          value={value(version.nativeBuild)}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.runtime')}
          value={version.runtimeVersion}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.channel')}
          value={value(version.channel)}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.server')}
          value={value(version.serverVersion)}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.releaseNotes.contract')}
          value={value(version.contractVersion)}
          isLast
        />
      </SettingsSection>

      <AdaptiveSurface>
        <View style={styles.releaseHeader}>
          <View style={styles.releaseTitle}>
            <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>
              {t('mobileSettings.releaseNotes.latestTitle')}
            </Text>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
              {t('mobileSettings.releaseNotes.latestStatus')}
            </Text>
          </View>
          <View style={[styles.versionBadge, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text style={[typography.caption, { color: theme.colors.primary, fontWeight: '700' }]}>
              {version.appVersion}
            </Text>
          </View>
        </View>
        {sections.map((section) => (
          <View
            key={section.id}
            style={[styles.releaseSection, { borderTopColor: theme.colors.border }]}
          >
            <Text style={[typography.headline, { color: theme.colors.text }]}>
              {t('mobileSettings.releaseNotes.sections.' + section.id)}
            </Text>
            <SettingsBulletList platform={platform} items={section.items} />
          </View>
        ))}
      </AdaptiveSurface>

      <SettingsAction
        platform={platform}
        kind="secondary"
        label={t('mobileSettings.releaseNotes.serverProfiles')}
        onPress={onOpenServerProfiles}
      />
    </SettingsDetailPage>
  );
}

const styles = StyleSheet.create({
  releaseHeader: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  releaseTitle: { minWidth: 0, flex: 1, gap: 2 },
  versionBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  releaseSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
});
