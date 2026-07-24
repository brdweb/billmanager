import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerProfiles } from '../../context/ServerProfileContext';
import { AdaptivePlatform } from '../../design/tokens';
import {
  configureFormatting,
  getFormattingConfig,
  type FormattingConfig,
} from '../../i18n/format';
import {
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  setLanguage,
  type SupportedLanguage,
} from '../../i18n';
import { formatLocaleExample } from './settingsModel';
import {
  SettingsAction,
  SettingsChoiceRow,
  SettingsDetailPage,
  SettingsInfoRow,
  SettingsSection,
} from './SettingsDetailComponents';

export function LanguageRegionScreenView({
  platform,
  onOpenServerProfiles,
}: {
  platform: AdaptivePlatform;
  onOpenServerProfiles: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { activeProfile } = useServerProfiles();
  const [formatting, setFormatting] = useState<FormattingConfig>(() => getFormattingConfig());
  const [saving, setSaving] = useState(false);
  const language = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  const chooseLanguage = async (nextLanguage: SupportedLanguage) => {
    if (saving || nextLanguage === language) return;
    setSaving(true);
    try {
      await setLanguage(nextLanguage);
      setFormatting(configureFormatting(
        activeProfile.capabilities?.defaultLocale,
        activeProfile.capabilities?.defaultCurrency,
        nextLanguage,
      ));
      void Haptics.selectionAsync();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDetailPage platform={platform} intro={t('mobileSettings.language.intro')}>
      <SettingsSection platform={platform} title={t('mobileSettings.language.appLanguage')}>
        {LANGUAGE_OPTIONS.map((option, index) => (
          <SettingsChoiceRow
            key={option.code}
            platform={platform}
            title={option.label}
            subtitle={option.code.toUpperCase()}
            selected={language === option.code}
            onPress={() => void chooseLanguage(option.code)}
            isLast={index === LANGUAGE_OPTIONS.length - 1}
          />
        ))}
      </SettingsSection>

      <SettingsSection platform={platform} title={t('mobileSettings.language.regionalFormat')}>
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.language.locale')}
          value={formatting.locale}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.language.currency')}
          value={formatting.currency}
        />
        <SettingsInfoRow
          platform={platform}
          label={t('mobileSettings.language.example')}
          value={formatLocaleExample(formatting)}
          isLast
        />
      </SettingsSection>

      <SettingsSection
        platform={platform}
        title={t('mobileSettings.groups.connection')}
      >
        <SettingsInfoRow
          platform={platform}
          label={activeProfile.displayName}
          value={t('mobileSettings.language.serverManaged', {
            profile: activeProfile.displayName,
          })}
          isLast
        />
      </SettingsSection>
      <SettingsAction
        platform={platform}
        kind="secondary"
        label={t('mobileSettings.language.changeServer')}
        onPress={onOpenServerProfiles}
      />
    </SettingsDetailPage>
  );
}
