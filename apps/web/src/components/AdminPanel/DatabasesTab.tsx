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
      const message = error instanceof ApiError ? error.message : 'Failed to load bill groups';
      notifications.show({
        title: 'Error loading bill groups',
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
        title: 'Validation error',
        message: 'Group name and display name are required',
        color: 'red',
      });
      return;
    }

    // Validate name format
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      notifications.show({
        title: 'Validation error',
        message: 'Group name can only contain letters, numbers, underscores, and hyphens',
        color: 'red',
      });
      return;
    }

    setAddLoading(true);
    try {
      await createDatabase(newName, newDisplayName, newDescription);
      notifications.show({
        message: 'Bill group created successfully',
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
      setNewName('');
      setNewDisplayName('');
      setNewDescription('');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to create bill group';
      notifications.show({
        title: 'Failed to create bill group',
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
        title: 'Validation error',
        message: 'Display name cannot be empty',
        color: 'red',
      });
      return;
    }

    setEditLoading(true);
    try {
      await updateDatabase(editingId, editDisplayName, editDescription);
      notifications.show({
        message: 'Bill group updated successfully',
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth();
      handleCancelEdit();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to update bill group';
      notifications.show({
        title: 'Failed to update bill group',
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

      let message = `Are you sure you want to delete "${db.display_name}"?\n\nThis will permanently delete all bills and payments in this group.`;

      if (usersWithAccess.length > 0) {
        const userNames = usersWithAccess.map((u) => u.username).join(', ');
        message = `WARNING: "${db.display_name}" has ${usersWithAccess.length} user(s) with access: ${userNames}\n\nDeleting will:\n- Permanently delete all bills and payments in this group\n- Remove access for all users\n\nContinue?`;
      }

      if (!confirm(message)) return;

      await deleteDatabase(db.id!);
      notifications.show({
        message: 'Bill group deleted successfully',
        color: 'green',
      });
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete bill group';
      notifications.show({
        title: 'Failed to delete bill group',
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
            <Table.Th>Name</Table.Th>
            <Table.Th>Display Name</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th>Actions</Table.Th>
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
                    placeholder="Display Name"
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
                    placeholder="Description (optional)"
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
                      title="Save"
                    >
                      <IconCheck size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={handleCancelEdit}
                      disabled={editLoading}
                      title="Cancel"
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
                      title="Edit"
                    >
                      <IconEdit size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeleteDatabase(db)}
                      title="Delete"
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
          <Text fw={500}>Create New Bill Group</Text>
          <Group grow>
            <TextInput
              label="Group Name"
              description="Used internally (letters, numbers, _, -)"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              placeholder="my_bills"
            />
            <TextInput
              label="Display Name"
              description="Shown to users"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.currentTarget.value)}
              placeholder="My Bills"
            />
            <TextInput
              label="Description"
              description="Optional"
              value={newDescription}
              onChange={(e) => setNewDescription(e.currentTarget.value)}
              placeholder="Description..."
            />
          </Group>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleAddDatabase}
            loading={addLoading}
            disabled={!newName || !newDisplayName}
          >
            Create Bill Group
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
