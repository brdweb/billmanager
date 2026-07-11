import { useEffect, useState } from 'react';
import { Alert, Button, Group, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';

export function AccountDangerZone() {
  const { t } = useTranslation();
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
        setError(t('accountDangerZone.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    loadMe();
  }, [t]);

  const handleDelete = async () => {
    setError('');

    const confirmed = window.confirm(t('accountDangerZone.deleteConfirm'));
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
      setError(hasPassword ? t('accountDangerZone.deleteFailedPassword') : t('accountDangerZone.deleteFailedDefault'));
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
        <Title order={4} c="red">{t('accountDangerZone.title')}</Title>
        <Text size="sm" c="dimmed">
          {t('accountDangerZone.description')}
        </Text>

        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {hasPassword ? (
          <Group align="flex-end">
            <PasswordInput
              label={t('accountDangerZone.passwordLabel')}
              placeholder={t('accountDangerZone.passwordPlaceholder')}
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
              {t('accountDangerZone.deleteButton')}
            </Button>
          </Group>
        ) : (
          <Button color="red" variant="filled" onClick={handleDelete} loading={deleting}>
            {t('accountDangerZone.deleteButton')}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
