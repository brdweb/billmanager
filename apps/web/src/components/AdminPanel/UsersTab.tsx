import { useState, useEffect } from 'react';
import {
  Stack,
  Table,
  Button,
  ActionIcon,
  Group,
  TextInput,
  Select,
  Modal,
  Checkbox,
  Text,
  Badge,
  Paper,
  Loader,
  Center,
  Divider,
  Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconEdit, IconMail, IconX, IconMailOff, IconUserPlus } from '@tabler/icons-react';
import type { User, Database, UserInvite } from '../../api/client';
import {
  getUsers,
  deleteUser,
  updateUser,
  getDatabases,
  getUserDatabases,
  grantDatabaseAccess,
  revokeDatabaseAccess,
  inviteUser,
  getInvites,
  cancelInvite,
  addUser,
  ApiError,
} from '../../api/client';
import { useConfig } from '../../context/ConfigContext';
import { useAuth } from '../../context/AuthContext';

interface UsersTabProps {
  isActive: boolean;
}

export function UsersTab({ isActive }: UsersTabProps) {
  const { emailEnabled, isSelfHosted } = useConfig();
  const { refreshAuth } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite user form (for SaaS with email enabled)
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('user');
  const [selectedDatabases, setSelectedDatabases] = useState<number[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Create user form (for self-hosted mode)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<string>('user');
  const [createDatabases, setCreateDatabases] = useState<number[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  // Edit user modal
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userDatabases, setUserDatabases] = useState<number[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState<'admin' | 'user'>('user');
  const [accessLoading, setAccessLoading] = useState(false);

  // Fetch data on mount and when tab becomes active
  useEffect(() => {
    if (isActive) {
      fetchData();
    }
  }, [isActive]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, dbsRes] = await Promise.all([
        getUsers(),
        getDatabases(),
      ]);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setDatabases(Array.isArray(dbsRes) ? dbsRes : []);

      // Fetch invites separately so it doesn't break if table doesn't exist yet
      try {
        const invitesRes = await getInvites();
        setInvites(Array.isArray(invitesRes) ? invitesRes : []);
      } catch (inviteError) {
        console.error('Failed to fetch invites:', inviteError);
        setInvites([]);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail) {
      notifications.show({
        title: 'Validation error',
        message: 'Email address is required',
        color: 'red',
      });
      return;
    }

    setInviteLoading(true);
    try {
      await inviteUser(inviteEmail, inviteRole, selectedDatabases);
      notifications.show({
        message: 'Invitation sent successfully',
        color: 'green',
      });
      await fetchData();
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteRole('user');
      setSelectedDatabases([]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to send invitation';
      notifications.show({
        title: 'Failed to send invitation',
        message,
        color: 'red',
      });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!createUsername || !createPassword) {
      notifications.show({
        title: 'Validation error',
        message: 'Username and password are required',
        color: 'red',
      });
      return;
    }

    setCreateLoading(true);
    try {
      await addUser(createUsername, createPassword, createRole, createDatabases);
      notifications.show({
        message: 'User created successfully',
        color: 'green',
      });
      await fetchData();
      setShowCreateForm(false);
      setCreateUsername('');
      setCreatePassword('');
      setCreateRole('user');
      setCreateDatabases([]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to create user';
      notifications.show({
        title: 'Failed to create user',
        message,
        color: 'red',
      });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId: number) => {
    if (!confirm('Are you sure you want to cancel this invitation?')) return;

    try {
      await cancelInvite(inviteId);
      notifications.show({
        message: 'Invitation cancelled',
        color: 'green',
      });
      await fetchData();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to cancel invitation';
      notifications.show({
        title: 'Failed to cancel invitation',
        message,
        color: 'red',
      });
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      await deleteUser(userId);
      notifications.show({
        message: 'User deleted successfully',
        color: 'green',
      });
      await fetchData();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete user';
      notifications.show({
        title: 'Failed to delete user',
        message,
        color: 'red',
      });
    }
  };

  const handleEditUser = async (user: User) => {
    setEditingUser(user);
    setUserEmail(user.email || '');
    setUserRole(user.role);
    setAccessLoading(true);
    try {
      // Fetch both fresh databases list and user's current access
      const [dbsRes, userDbsRes] = await Promise.all([
        getDatabases(),
        getUserDatabases(user.id),
      ]);
      setDatabases(Array.isArray(dbsRes) ? dbsRes : []);
      setUserDatabases(Array.isArray(userDbsRes) ? userDbsRes.map((db) => db.id!) : []);
    } catch (error) {
      console.error('Failed to fetch user databases:', error);
    } finally {
      setAccessLoading(false);
    }
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;

    setAccessLoading(true);
    try {
      // Build update payload for changed fields
      const updatePayload: { email?: string | null; role?: 'admin' | 'user' } = {};

      const newEmail = userEmail.trim() || null;
      if (newEmail !== (editingUser.email || null)) {
        updatePayload.email = newEmail;
      }

      if (userRole !== editingUser.role) {
        updatePayload.role = userRole;
      }

      // Update user if there are changes
      if (Object.keys(updatePayload).length > 0) {
        await updateUser(editingUser.id, updatePayload);
      }

      // Get current databases
      const currentRes = await getUserDatabases(editingUser.id);
      const currentDbIds = currentRes.map((db) => db.id!);

      // Find databases to add and remove
      const toAdd = userDatabases.filter((id) => !currentDbIds.includes(id));
      const toRemove = currentDbIds.filter((id) => !userDatabases.includes(id));

      // Perform updates
      await Promise.all([
        ...toAdd.map((dbId) => grantDatabaseAccess(dbId, editingUser.id)),
        ...toRemove.map((dbId) => revokeDatabaseAccess(dbId, editingUser.id)),
      ]);

      notifications.show({
        message: 'User updated successfully',
        color: 'green',
      });
      await fetchData();
      // Refresh auth state to update database list in header dropdown
      await refreshAuth();
      setEditingUser(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to update user';
      notifications.show({
        title: 'Failed to update user',
        message,
        color: 'red',
      });
    } finally {
      setAccessLoading(false);
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
      {/* Users Table */}
      <Text fw={600} size="sm">Users</Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Username</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>{user.username}</Table.Td>
              <Table.Td>
                <Text size="sm" c={user.email ? undefined : 'dimmed'}>
                  {user.email || '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={user.role === 'admin' ? 'orange' : 'blue'}>
                  {user.role}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <ActionIcon
                    variant="subtle"
                    color="blue"
                    onClick={() => handleEditUser(user)}
                    title="Edit User"
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => handleDeleteUser(user.id)}
                    title="Delete"
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Divider my="sm" />

      {/* User Creation Section */}
      {isSelfHosted ? (
        /* Self-hosted mode: Direct user creation */
        !showCreateForm ? (
          <Button
            leftSection={<IconUserPlus size={16} />}
            variant="light"
            onClick={async () => {
              // Refresh databases before showing form
              try {
                const dbsRes = await getDatabases();
                setDatabases(Array.isArray(dbsRes) ? dbsRes : []);
              } catch (error) {
                console.error('Failed to refresh databases:', error);
              }
              setShowCreateForm(true);
            }}
          >
            Create User
          </Button>
        ) : (
          <Paper p="md" withBorder>
            <Stack gap="sm">
              <Text fw={500}>Create New User</Text>
              <Text size="sm" c="dimmed">
                Create a user account with username and password. The user can log in immediately.
              </Text>
              <Group grow>
                <TextInput
                  label="Username"
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.currentTarget.value)}
                  placeholder="johndoe"
                  required
                />
                <TextInput
                  label="Password"
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.currentTarget.value)}
                  placeholder="••••••••"
                  required
                />
              </Group>
              <Select
                label="Role"
                value={createRole}
                onChange={(val) => setCreateRole(val || 'user')}
                data={[
                  { value: 'user', label: 'User' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />

              <Text size="sm" fw={500}>
                Bill Group Access
              </Text>
              <Group>
                {databases.map((db) => (
                  <Checkbox
                    key={db.id}
                    label={db.display_name}
                    checked={createDatabases.includes(db.id!)}
                    onChange={(e) => {
                      if (e.currentTarget.checked) {
                        setCreateDatabases([...createDatabases, db.id!]);
                      } else {
                        setCreateDatabases(createDatabases.filter((id) => id !== db.id));
                      }
                    }}
                  />
                ))}
              </Group>

              <Group>
                <Button
                  onClick={handleCreateUser}
                  loading={createLoading}
                  leftSection={<IconUserPlus size={16} />}
                >
                  Create User
                </Button>
                <Button variant="default" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
              </Group>
            </Stack>
          </Paper>
        )
      ) : emailEnabled ? (
        /* SaaS mode with email: Email invitations */
        <>
          {/* Pending Invitations */}
          {invites.length > 0 && (
            <>
              <Text fw={600} size="sm">Pending Invitations</Text>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Expires</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {invites.map((invite) => (
                    <Table.Tr key={invite.id}>
                      <Table.Td>{invite.email}</Table.Td>
                      <Table.Td>
                        <Badge color={invite.role === 'admin' ? 'orange' : 'blue'}>
                          {invite.role}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {new Date(invite.expires_at).toLocaleDateString()}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleCancelInvite(invite.id)}
                          title="Cancel Invitation"
                        >
                          <IconX size={18} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}

          <Divider my="sm" />

          {/* Invite User Form */}
          {!showInviteForm ? (
            <Button
              leftSection={<IconMail size={16} />}
              variant="light"
              onClick={async () => {
                // Refresh databases before showing form
                try {
                  const dbsRes = await getDatabases();
                  setDatabases(Array.isArray(dbsRes) ? dbsRes : []);
                } catch (error) {
                  console.error('Failed to refresh databases:', error);
                }
                setShowInviteForm(true);
              }}
            >
              Invite User
            </Button>
          ) : (
            <Paper p="md" withBorder>
              <Stack gap="sm">
                <Text fw={500}>Invite New User</Text>
                <Text size="sm" c="dimmed">
                  Send an invitation email. The user will set their own username and password.
                </Text>
                <Group grow>
                  <TextInput
                    label="Email Address"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.currentTarget.value)}
                    placeholder="user@example.com"
                  />
                  <Select
                    label="Role"
                    value={inviteRole}
                    onChange={(val) => setInviteRole(val || 'user')}
                    data={[
                      { value: 'user', label: 'User' },
                      { value: 'admin', label: 'Admin' },
                    ]}
                  />
                </Group>

                <Text size="sm" fw={500}>
                  Bill Group Access
                </Text>
                <Group>
                  {databases.map((db) => (
                    <Checkbox
                      key={db.id}
                      label={db.display_name}
                      checked={selectedDatabases.includes(db.id!)}
                      onChange={(e) => {
                        if (e.currentTarget.checked) {
                          setSelectedDatabases([...selectedDatabases, db.id!]);
                        } else {
                          setSelectedDatabases(selectedDatabases.filter((id) => id !== db.id));
                        }
                      }}
                    />
                  ))}
                </Group>

                <Group>
                  <Button
                    onClick={handleInviteUser}
                    loading={inviteLoading}
                    leftSection={<IconMail size={16} />}
                  >
                    Send Invitation
                  </Button>
                  <Button variant="default" onClick={() => setShowInviteForm(false)}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </>
      ) : (
        <>
          <Divider my="sm" />
          <Alert icon={<IconMailOff size={16} />} color="gray" variant="light">
            <Text size="sm">
              Email invitations are not available. Configure RESEND_API_KEY to enable sending invitations.
            </Text>
          </Alert>
        </>
      )}

      {/* Edit User Modal */}
      <Modal
        opened={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={`Edit User: ${editingUser?.username}`}
        centered
      >
        <Stack gap="md">
          {accessLoading ? (
            <Center py="md">
              <Loader />
            </Center>
          ) : (
            <>
              <TextInput
                label="Email"
                placeholder="user@example.com"
                value={userEmail}
                onChange={(e) => setUserEmail(e.currentTarget.value)}
              />

              <Select
                label="Role"
                value={userRole}
                onChange={(val) => setUserRole((val as 'admin' | 'user') || 'user')}
                data={[
                  { value: 'user', label: 'User' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />

              <Text size="sm" fw={500}>
                Bill Group Access
              </Text>
              {databases.map((db) => (
                <Checkbox
                  key={db.id}
                  label={db.display_name}
                  description={db.description}
                  checked={userDatabases.includes(db.id!)}
                  onChange={(e) => {
                    if (e.currentTarget.checked) {
                      setUserDatabases([...userDatabases, db.id!]);
                    } else {
                      setUserDatabases(userDatabases.filter((id) => id !== db.id));
                    }
                  }}
                />
              ))}

              <Group justify="flex-end">
                <Button variant="default" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveUser}>Save Changes</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
