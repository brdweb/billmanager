import { Container, Title, Stack, Divider, Select, Tabs, Box } from '@mantine/core';
import { IconSettings, IconLanguage, IconUsers, IconFolders } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { TwoFactorSettings } from '../components/TwoFactorSettings';
import { LinkedAccounts } from '../components/LinkedAccounts';
import { AccountDangerZone } from '../components/AccountDangerZone';
import { UsersTab } from '../components/AdminPanel/UsersTab';
import { DatabasesTab } from '../components/AdminPanel/DatabasesTab';
import { useAuth } from '../context/AuthContext';
import { isSupportedLanguage, LANGUAGE_OPTIONS, setLanguage } from '../i18n';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = isAdmin && (requestedTab === 'users' || requestedTab === 'databases')
    ? requestedTab
    : 'settings';

  const handleTabChange = (value: string | null) => {
    if (!value || value === 'settings') {
      setSearchParams({}, { replace: true });
      return;
    }

    if (isAdmin && (value === 'users' || value === 'databases')) {
      setSearchParams({ tab: value }, { replace: true });
    }
  };

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Title order={2}>
          <IconSettings size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          {t('settingsPage.title')}
        </Title>

        <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>
              {t('settingsPage.tabs.settings')}
            </Tabs.Tab>
            {isAdmin && (
              <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
                {t('admin.tabs.users')}
              </Tabs.Tab>
            )}
            {isAdmin && (
              <Tabs.Tab value="databases" leftSection={<IconFolders size={16} />}>
                {t('admin.tabs.billGroups')}
              </Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="settings" pt="lg">
            <Box maw={720}>
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

                <TwoFactorSettings />

                <Divider />

                <LinkedAccounts />

                <Divider />

                <AccountDangerZone />
              </Stack>
            </Box>
          </Tabs.Panel>

          {isAdmin && (
            <Tabs.Panel value="users" pt="lg">
              <UsersTab isActive={activeTab === 'users'} />
            </Tabs.Panel>
          )}

          {isAdmin && (
            <Tabs.Panel value="databases" pt="lg">
              <DatabasesTab />
            </Tabs.Panel>
          )}
        </Tabs>
      </Stack>
    </Container>
  );
}
