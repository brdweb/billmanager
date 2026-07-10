import { useState, useEffect } from 'react';
import {
  Stack,
  Table,
  Button,
  ActionIcon,
  Group,
  TextInput,
  Text,
  Paper,
  Loader,
  Center,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconPlus, IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Database } from '../../api/client';
import {
  getDatabases,
  createDatabase,
  deleteDatabase,
  updateDatabase,
  getDatabaseAccess,
  ApiError,
} from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export function DatabasesTab() {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const { refreshAuth } = useAuth();

  // Add database form
  const [newName, setNewName] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    fetchDatabases();
  }, []);

  const fetchDatabases = async () => {
    setLoading(true);
    try {
      const response = await getDatabases();
      setDatabases(Array.isArray(response) ? response : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('admin.databases.errors.loadFailed');
      notifications.show({
        title: t('admin.databases.errors.loadFailedTitle'),
        message,
        color: 'red',
      });
      setDatabases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDatabase = async () => {
    if (!newName || !newDisplayName) {
      notifications.show({
        title: t('admin.databases.errors.validationTitle'),
        message: t('admin.databases.errors.nameAndDisplayRequired'),
        color: 'red',
      });
      return;
    }

    // Validate name format
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      notifications.show({
        title: t('admin.databases.errors.validationTitle'),
        message: t('admin.databases.errors.nameFormat'),
        color: 'red',
      });
      return;
    }

    setAddLoading(true);
    try {
      await createDatabase(newName, newDisplayName, newDescription);
      notifications.show({
        message: t('admin.databases.success.created'),
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
      setNewName('');
      setNewDisplayName('');
      setNewDescription('');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('admin.databases.errors.createFailed');
      notifications.show({
        title: t('admin.databases.errors.createFailed'),
        message,
        color: 'red',
      });
    } finally {
      setAddLoading(false);
    }
  };

  const handleStartEdit = (db: Database) => {
    setEditingId(db.id!);
    setEditDisplayName(db.display_name);
    setEditDescription(db.description || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditDisplayName('');
    setEditDescription('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editDisplayName.trim()) {
      notifications.show({
        title: t('admin.databases.errors.validationTitle'),
        message: t('admin.databases.errors.displayNameEmpty'),
        color: 'red',
      });
      return;
    }

    setEditLoading(true);
    try {
      await updateDatabase(editingId, editDisplayName, editDescription);
      notifications.show({
        message: t('admin.databases.success.updated'),
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth();
      handleCancelEdit();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('admin.databases.errors.updateFailed');
      notifications.show({
        title: t('admin.databases.errors.updateFailed'),
        message,
        color: 'red',
      });
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteDatabase = async (db: Database) => {
    // Check for users with access
    try {
      const accessRes = await getDatabaseAccess(db.id!);
      const usersWithAccess = accessRes ?? [];

      let message = t('admin.databases.deleteConfirm', { name: db.display_name });

      if (usersWithAccess.length > 0) {
        const userNames = usersWithAccess.map((u) => u.username).join(', ');
        message = t('admin.databases.deleteConfirmWithUsers', { name: db.display_name, count: usersWithAccess.length, users: userNames });
      }

      if (!confirm(message)) return;

      await deleteDatabase(db.id!);
      notifications.show({
        message: t('admin.databases.success.deleted'),
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('admin.databases.errors.deleteFailed');
      notifications.show({
        title: t('admin.databases.errors.deleteFailed'),
        message,
        color: 'red',
      });
    }
  };

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('common.table.name')}</Table.Th>
            <Table.Th>{t('admin.databases.columns.displayName')}</Table.Th>
            <Table.Th>{t('admin.databases.columns.description')}</Table.Th>
            <Table.Th>{t('common.table.actions')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {databases.map((db) => (
            <Table.Tr key={db.id}>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {db.name}
                </Text>
              </Table.Td>
              <Table.Td>
                {editingId === db.id ? (
                  <TextInput
                    size="sm"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.currentTarget.value)}
                    placeholder={t('admin.databases.editDisplayNamePlaceholder')}
                  />
                ) : (
                  <Text fw={500}>{db.display_name}</Text>
                )}
              </Table.Td>
              <Table.Td>
                {editingId === db.id ? (
                  <TextInput
                    size="sm"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.currentTarget.value)}
                    placeholder={t('admin.databases.editDescriptionPlaceholder')}
                  />
                ) : (
                  <Text size="sm" c="dimmed">
                    {db.description || '-'}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {editingId === db.id ? (
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      color="green"
                      onClick={handleSaveEdit}
                      loading={editLoading}
                      disabled={!editDisplayName.trim()}
                      title={t('common.actions.save')}
                    >
                      <IconCheck size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={handleCancelEdit}
                      disabled={editLoading}
                      title={t('common.actions.cancel')}
                    >
                      <IconX size={18} />
                    </ActionIcon>
                  </Group>
                ) : (
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      color="blue"
                      onClick={() => handleStartEdit(db)}
                      title={t('common.actions.edit')}
                    >
                      <IconEdit size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeleteDatabase(db)}
                      title={t('common.actions.delete')}
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={500}>{t('admin.databases.createTitle')}</Text>
          <Group grow>
            <TextInput
              label={t('admin.databases.groupNameLabel')}
              description={t('admin.databases.groupNameDescription')}
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              placeholder={t('admin.databases.groupNamePlaceholder')}
            />
            <TextInput
              label={t('admin.databases.displayNameLabel')}
              description={t('admin.databases.displayNameDescription')}
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.currentTarget.value)}
              placeholder={t('admin.databases.displayNamePlaceholder')}
            />
            <TextInput
              label={t('admin.databases.descriptionLabel')}
              description={t('admin.databases.descriptionDescription')}
              value={newDescription}
              onChange={(e) => setNewDescription(e.currentTarget.value)}
              placeholder={t('admin.databases.descriptionPlaceholder')}
            />
          </Group>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleAddDatabase}
            loading={addLoading}
            disabled={!newName || !newDisplayName}
          >
            {t('admin.databases.createButton')}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
