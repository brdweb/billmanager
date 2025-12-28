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
import { IconTrash, IconPlus } from '@tabler/icons-react';
import type { Database } from '../../api/client';
import {
  getDatabases,
  createDatabase,
  deleteDatabase,
  getDatabaseAccess,
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

  useEffect(() => {
    fetchDatabases();
  }, []);

  const fetchDatabases = async () => {
    setLoading(true);
    try {
      const response = await getDatabases();
      setDatabases(response);
    } catch (error) {
      console.error('Failed to fetch databases:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDatabase = async () => {
    if (!newName || !newDisplayName) return;

    // Validate name format
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      alert('Group name can only contain letters, numbers, underscores, and hyphens');
      return;
    }

    setAddLoading(true);
    try {
      await createDatabase(newName, newDisplayName, newDescription);
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
      setNewName('');
      setNewDisplayName('');
      setNewDescription('');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'Failed to create bill group');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDatabase = async (db: Database) => {
    // Check for users with access
    try {
      const accessRes = await getDatabaseAccess(db.id!);
      const usersWithAccess = accessRes;

      let message = `Are you sure you want to delete "${db.display_name}"?\n\nThis will permanently delete all bills and payments in this group.`;

      if (usersWithAccess.length > 0) {
        const userNames = usersWithAccess.map((u) => u.username).join(', ');
        message = `WARNING: "${db.display_name}" has ${usersWithAccess.length} user(s) with access: ${userNames}\n\nDeleting will:\n- Permanently delete all bills and payments in this group\n- Remove access for all users\n\nContinue?`;
      }

      if (!confirm(message)) return;

      await deleteDatabase(db.id!);
      await fetchDatabases();
      await refreshAuth(); // Refresh user's database list
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'Failed to delete bill group');
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
                <Text fw={500}>{db.display_name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {db.description || '-'}
                </Text>
              </Table.Td>
              <Table.Td>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => handleDeleteDatabase(db)}
                  title="Delete"
                >
                  <IconTrash size={18} />
                </ActionIcon>
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
