import { useState } from 'react';
import { Modal, Tabs } from '@mantine/core';
import { IconUsers, IconFolders, IconShieldLock } from '@tabler/icons-react';
import { UsersTab } from './UsersTab';
import { DatabasesTab } from './DatabasesTab';
import { TwoFactorSettings } from '../TwoFactorSettings';
import { LinkedAccounts } from '../LinkedAccounts';
import { useConfig } from '../../context/ConfigContext';

interface AdminModalProps {
  opened: boolean;
  onClose: () => void;
}

export function AdminModal({ opened, onClose }: AdminModalProps) {
  const [activeTab, setActiveTab] = useState<string | null>('users');
  const { config } = useConfig();
  const showSecurity = config?.twofa_enabled || (config?.oauth_providers && config.oauth_providers.length > 0);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Admin Panel"
      size="xl"
      centered
    >
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="databases" leftSection={<IconFolders size={16} />}>
            Bill Groups
          </Tabs.Tab>
          {showSecurity && (
            <Tabs.Tab value="security" leftSection={<IconShieldLock size={16} />}>
              Security
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <UsersTab isActive={activeTab === 'users'} />
        </Tabs.Panel>

        <Tabs.Panel value="databases" pt="md">
          <DatabasesTab />
        </Tabs.Panel>

        {showSecurity && (
          <Tabs.Panel value="security" pt="md">
            <TwoFactorSettings />
            <LinkedAccounts />
          </Tabs.Panel>
        )}
      </Tabs>
    </Modal>
  );
}
