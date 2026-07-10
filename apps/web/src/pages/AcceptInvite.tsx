import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Text,
  Anchor,
  Progress,
  List,
  Loader,
  Center,
} from '@mantine/core';
import { IconUser, IconLock, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { getInviteInfo, acceptInvite } from '../api/client';

function getPasswordStrength(password: string): number {
  let strength = 0;
  if (password.length >= 8) strength += 25;
  if (password.length >= 12) strength += 15;
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/[0-9]/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;
  return Math.min(100, strength);
}

function getPasswordColor(strength: number): string {
  if (strength < 30) return 'red';
  if (strength < 60) return 'yellow';
  if (strength < 80) return 'blue';
  return 'green';
}

export function AcceptInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // Invite info
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState('');

  // Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdUsername, setCreatedUsername] = useState('');

  const passwordStrength = getPasswordStrength(password);

  // Fetch invite info on mount
  useEffect(() => {
    if (!token) {
      setInviteError(t('acceptInvite.invalidLink'));
      setInviteLoading(false);
      return;
    }

    const fetchInviteInfo = async () => {
      try {
        const response = await getInviteInfo(token);
        setInviteEmail(response.email);
        setInvitedBy(response.invited_by);
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        setInviteError(error.response?.data?.error || t('acceptInvite.invalidExpiredDefault'));
      } finally {
        setInviteLoading(false);
      }
    };

    fetchInviteInfo();
  }, [token, t]);

  const validateForm = (): string | null => {
    if (!username.trim()) return t('loginPage.usernameRequired');
    if (username.length < 3) return t('loginPage.usernameMinLength');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return t('acceptInvite.usernameFormat');
    if (!password) return t('loginPage.passwordRequired');
    if (password.length < 8) return t('loginPage.passwordMinLength');
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
      return t('loginPage.passwordCase');
    }
    if (!/[0-9]/.test(password)) return t('loginPage.passwordNumber');
    if (password !== confirmPassword) return t('loginPage.passwordsMismatch');
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!token) {
      setError(t('acceptInvite.invalidToken'));
      return;
    }

    setLoading(true);
    try {
      const response = await acceptInvite(token, username, password);
      setCreatedUsername(response.username);
      setSuccess(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t('acceptInvite.createFailedDefault'));
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (inviteLoading) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Center py="xl">
            <Stack align="center" gap="md">
              <Loader size="lg" />
              <Text c="dimmed">{t('acceptInvite.loadingInvitation')}</Text>
            </Stack>
          </Center>
        </Paper>
      </Container>
    );
  }

  // Invalid/expired invite
  if (inviteError) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Stack align="center" gap="md">
            <IconAlertCircle size={48} color="var(--mantine-color-red-6)" />
            <Title order={2} ta="center">{t('acceptInvite.invalidInvitationTitle')}</Title>
            <Text c="dimmed" ta="center">
              {inviteError}
            </Text>
            <Button variant="light" onClick={() => navigate('/login')}>
              {t('acceptInvite.goToLogin')}
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  // Success state
  if (success) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Stack align="center" gap="md">
            <IconCheck size={48} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">{t('acceptInvite.accountCreatedTitle')}</Title>
            <Text c="dimmed" ta="center">
              {t('acceptInvite.accountCreatedBody')}{' '}
              <strong>{createdUsername}</strong>.
            </Text>
            <Button onClick={() => navigate('/login')}>
              {t('loginPage.signIn')}
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center">{t('acceptInvite.acceptInvitationTitle')}</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        <strong>{invitedBy}</strong> {t('acceptInvite.invitedBySuffix')}
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                {error}
              </Alert>
            )}

            <TextInput
              label={t('loginPage.emailLabel')}
              value={inviteEmail}
              disabled
              description={t('acceptInvite.emailDescription')}
            />

            <TextInput
              label={t('loginModal.usernameLabel')}
              placeholder={t('loginPage.chooseUsernamePlaceholder')}
              leftSection={<IconUser size={16} />}
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              description={t('acceptInvite.usernameDescription')}
              required
            />

            <div>
              <PasswordInput
                label={t('loginModal.passwordLabel')}
                placeholder={t('loginPage.createPasswordPlaceholder')}
                leftSection={<IconLock size={16} />}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {password && (
                <>
                  <Progress
                    value={passwordStrength}
                    color={getPasswordColor(passwordStrength)}
                    size="xs"
                    mt={5}
                  />
                  <Text size="xs" c="dimmed" mt={5}>
                    {t('acceptInvite.passwordRequirements')}
                  </Text>
                  <List size="xs" c="dimmed" spacing={0}>
                    <List.Item c={password.length >= 8 ? 'green' : undefined}>
                      {t('loginPage.atLeast8Chars')}
                    </List.Item>
                    <List.Item c={/[a-z]/.test(password) && /[A-Z]/.test(password) ? 'green' : undefined}>
                      {t('loginPage.upperLowerLetters')}
                    </List.Item>
                    <List.Item c={/[0-9]/.test(password) ? 'green' : undefined}>
                      {t('loginPage.atLeastOneNumber')}
                    </List.Item>
                  </List>
                </>
              )}
            </div>

            <PasswordInput
              label={t('loginPage.confirmPasswordLabel')}
              placeholder={t('loginPage.confirmPasswordPlaceholder')}
              leftSection={<IconLock size={16} />}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? t('loginPage.passwordsMismatch') : undefined}
              required
            />

            <Button type="submit" fullWidth loading={loading}>
              {t('loginPage.createAccount')}
            </Button>

            <Text size="sm" c="dimmed" ta="center">
              {t('acceptInvite.alreadyHaveAccount')}{' '}
              <Anchor component={Link} to="/login" size="sm">
                {t('acceptInvite.signInLink')}
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
