import { Container, Title, Stack, Divider, Select } from '@mantine/core';
import { IconSettings, IconLanguage } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { TwoFactorSettings } from '../components/TwoFactorSettings';
import { LinkedAccounts } from '../components/LinkedAccounts';
import { AccountDangerZone } from '../components/AccountDangerZone';
import { isSupportedLanguage, LANGUAGE_OPTIONS, setLanguage } from '../i18n';

export function Settings() {
  const { t, i18n } = useTranslation();

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Select
          label={t('settingsPage.languageLabel')}
          leftSection={<IconLanguage size={16} />}
          data={LANGUAGE_OPTIONS}
          value={i18n.language}
          onChange={(value) => value && isSupportedLanguage(value) && setLanguage(value)}
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
