import { useState } from 'react';
import { Modal, Tabs } from '@mantine/core';
import { IconUsers, IconFolders } from '@tabler/icons-react';
import { UsersTab } from './UsersTab';
import { DatabasesTab } from './DatabasesTab';

interface AdminModalProps {
  opened: boolean;
  onClose: () => void;
}

export function AdminModal({ opened, onClose }: AdminModalProps) {
  const [activeTab, setActiveTab] = useState<string | null>('users');

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
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <UsersTab isActive={activeTab === 'users'} />
        </Tabs.Panel>

        <Tabs.Panel value="databases" pt="md">
          <DatabasesTab />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
