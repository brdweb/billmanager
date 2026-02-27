import { useEffect, useState } from 'react';
import { Alert, Button, Group, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import * as api from '../api/client';

export function AccountDangerZone() {
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [hasPassword, setHasPassword] = useState(true);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const loadMe = async () => {
      try {
        const me = await api.getMe();
        setHasPassword(Boolean(me.user.has_password));
      } catch {
        setError('Failed to load account settings');
      } finally {
        setLoading(false);
      }
    };

    loadMe();
  }, []);

  const handleDelete = async () => {
    setError('');

    const confirmed = window.confirm(
      'Delete your entire account and all data permanently? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      if (hasPassword) {
        await api.deleteMyAccount({ password });
      } else {
        await api.deleteMyAccount({ confirm: true });
      }

      try {
        await api.logout();
      } catch {
        // account already deleted; ignore logout failure
      }
      window.location.href = '/login';
    } catch {
      setError(hasPassword ? 'Failed to delete account. Check your password.' : 'Failed to delete account.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <Paper withBorder p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
      <Stack gap="sm">
        <Title order={4} c="red">Danger Zone</Title>
        <Text size="sm" c="dimmed">
          Deleting your account permanently removes your users, databases, bills, and security data.
        </Text>

        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {hasPassword ? (
          <Group align="flex-end">
            <PasswordInput
              label="Confirm with password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              color="red"
              variant="filled"
              onClick={handleDelete}
              loading={deleting}
              disabled={!password}
            >
              Delete Account
            </Button>
          </Group>
        ) : (
          <Button color="red" variant="filled" onClick={handleDelete} loading={deleting}>
            Delete Account
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
