import { Container, Title, Stack, Divider, Select } from '@mantine/core';
import { IconSettings, IconLanguage } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { TwoFactorSettings } from '../components/TwoFactorSettings';
import { LinkedAccounts } from '../components/LinkedAccounts';
import { AccountDangerZone } from '../components/AccountDangerZone';
import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../i18n';

// Language names are shown in their own language (endonyms), not translated.
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
};

export function Settings() {
  const { t, i18n } = useTranslation();

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Select
          label={t('settingsPage.languageLabel')}
          leftSection={<IconLanguage size={16} />}
          data={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: LANGUAGE_NAMES[lang] }))}
          value={i18n.language}
          onChange={(value) => value && setLanguage(value as SupportedLanguage)}
          allowDeselect={false}
          w={220}
        />

        <Divider />

        <Title order={2}>
          <IconSettings size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          {t('settingsPage.title')}
        </Title>

        <TwoFactorSettings />

        <Divider />

        <LinkedAccounts />

        <Divider />

        <AccountDangerZone />
      </Stack>
    </Container>
  );
}
