import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Modal,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Text,
  Anchor,
  Divider,
} from '@mantine/core';
import { IconUser, IconLock, IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

interface LoginModalProps {
  opened: boolean;
  onClose: () => void;
  onPasswordChangeRequired: () => void;
}

export function LoginModal({ opened, onClose, onPasswordChangeRequired }: LoginModalProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, pendingPasswordChange } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarning('');

    if (!username.trim() || !password.trim()) {
      setError(t('loginModal.usernamePasswordRequired'));
      return;
    }

    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        // Check if password change is required (will be set in AuthContext)
        setTimeout(() => {
          if (pendingPasswordChange) {
            onPasswordChangeRequired();
          }
        }, 100);

        // Show warning if user has no database access
        if (result.warning) {
          setWarning(result.warning);
          // Don't close modal - let user see the warning
        } else {
          onClose();
          setUsername('');
          setPassword('');
        }
      } else {
        setError(t('loginModal.invalidCredentials'));
      }
    } catch {
      setError(t('loginModal.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('loginModal.title')}
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title={t('loginModal.errorTitle')}
              color="red"
              variant="light"
            >
              {error}
            </Alert>
          )}

          {warning && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              title={t('loginModal.warningTitle')}
              color="yellow"
              variant="light"
            >
              {warning}
            </Alert>
          )}

          <TextInput
            label={t('loginModal.usernameLabel')}
            placeholder={t('loginModal.usernamePlaceholder')}
            leftSection={<IconUser size={16} />}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            onKeyPress={handleKeyPress}
            required
          />

          <PasswordInput
            label={t('loginModal.passwordLabel')}
            placeholder={t('loginModal.passwordPlaceholder')}
            leftSection={<IconLock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            onKeyPress={handleKeyPress}
            required
          />

          <Button type="submit" fullWidth loading={loading}>
            {t('loginModal.loginButton')}
          </Button>

          <Anchor
            component={Link}
            to="/forgot-password"
            size="sm"
            ta="center"
            onClick={onClose}
          >
            {t('loginModal.forgotPassword')}
          </Anchor>

          <Divider label={t('loginModal.or')} labelPosition="center" />

          <Text size="sm" ta="center">
            {t('loginModal.noAccount')}{' '}
            <Anchor component={Link} to="/register" onClick={onClose}>
              {t('loginModal.signUp')}
            </Anchor>
          </Text>
        </Stack>
      </form>
    </Modal>
  );
}
