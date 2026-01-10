import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Button,
  Stack,
  Alert,
  Text,
  Anchor,
  Loader,
  Center,
  Group,
  Badge,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconCurrencyDollar } from '@tabler/icons-react';
import { getShareInviteDetails, acceptShareByToken } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function AcceptShareInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { isLoggedIn } = useAuth();

  // Invite info
  const [inviteData, setInviteData] = useState<{
    bill_name: string;
    bill_amount: number;
    owner_username: string;
    shared_with_email: string;
    split_type: string | null;
    split_value: number | null;
    my_portion: number | null;
  } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState('');

  // Form state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Fetch invite info on mount
  useEffect(() => {
    if (!token) {
      setInviteError('Invalid invitation link. Please check the link and try again.');
      setInviteLoading(false);
      return;
    }

    const fetchInviteInfo = async () => {
      try {
        const response = await getShareInviteDetails(token);
        setInviteData(response);
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        setInviteError(error.response?.data?.error || 'This invitation is invalid or has expired.');
      } finally {
        setInviteLoading(false);
      }
    };

    fetchInviteInfo();
  }, [token]);

  const handleAccept = async () => {
    if (!token) {
      setError('Invalid invitation token');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await acceptShareByToken(token);
      setSuccess(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to accept invitation. Please try again.');
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
              <Text c="dimmed">Loading invitation...</Text>
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
            <Title order={2} ta="center">Invalid Invitation</Title>
            <Text c="dimmed" ta="center">
              {inviteError}
            </Text>
            <Button variant="light" onClick={() => navigate('/login')}>
              Go to Login
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
            <Title order={2} ta="center">Share Accepted!</Title>
            <Text c="dimmed" ta="center">
              You have successfully accepted the shared bill. You can now view it in your bills list.
            </Text>
            <Button onClick={() => navigate('/')}>
              Go to Bills
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  // Not logged in - show invitation details and prompt to login
  if (!isLoggedIn) {
    return (
      <Container size={500} my={40}>
        <Title ta="center">Bill Share Invitation</Title>
        <Text c="dimmed" size="sm" ta="center" mt={5}>
          <strong>{inviteData?.owner_username}</strong> has invited you to share a bill
        </Text>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Stack gap="md">
            <div>
              <Text size="sm" c="dimmed" mb={5}>Bill Name</Text>
              <Text size="lg" fw={500}>{inviteData?.bill_name}</Text>
            </div>

            <div>
              <Text size="sm" c="dimmed" mb={5}>Full Amount</Text>
              <Group gap="xs">
                <IconCurrencyDollar size={20} />
                <Text size="lg" fw={500}>${inviteData?.bill_amount.toFixed(2)}</Text>
              </Group>
            </div>

            {inviteData && inviteData.my_portion !== null && (
              <div>
                <Text size="sm" c="dimmed" mb={5}>Your Portion</Text>
                <Group gap="xs">
                  <Badge color="blue" size="lg">
                    ${inviteData.my_portion.toFixed(2)}
                  </Badge>
                  {inviteData.split_type === 'percentage' && (
                    <Text size="sm" c="dimmed">({inviteData.split_value}%)</Text>
                  )}
                  {inviteData.split_type === 'equal' && (
                    <Text size="sm" c="dimmed">(Split equally)</Text>
                  )}
                </Group>
              </div>
            )}

            <div>
              <Text size="sm" c="dimmed" mb={5}>Shared with</Text>
              <Text size="sm">{inviteData?.shared_with_email}</Text>
            </div>

            <Alert color="blue" variant="light">
              You need to sign in to accept this invitation
            </Alert>

            <Button
              fullWidth
              onClick={() => navigate(`/login?redirect=/accept-share-invite?token=${token}`)}
            >
              Sign In to Accept
            </Button>

            <Text size="sm" c="dimmed" ta="center">
              Don't have an account?{' '}
              <Anchor component={Link} to={`/accept-invite?token=${token}`} size="sm">
                Create one
              </Anchor>
            </Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  // Logged in - show accept button
  return (
    <Container size={500} my={40}>
      <Title ta="center">Bill Share Invitation</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        <strong>{inviteData?.owner_username}</strong> has invited you to share a bill
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <Stack gap="md">
          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          <div>
            <Text size="sm" c="dimmed" mb={5}>Bill Name</Text>
            <Text size="lg" fw={500}>{inviteData?.bill_name}</Text>
          </div>

          <div>
            <Text size="sm" c="dimmed" mb={5}>Full Amount</Text>
            <Group gap="xs">
              <IconCurrencyDollar size={20} />
              <Text size="lg" fw={500}>${inviteData?.bill_amount.toFixed(2)}</Text>
            </Group>
          </div>

          {inviteData && inviteData.my_portion !== null && (
            <div>
              <Text size="sm" c="dimmed" mb={5}>Your Portion</Text>
              <Group gap="xs">
                <Badge color="blue" size="lg">
                  ${inviteData.my_portion.toFixed(2)}
                </Badge>
                {inviteData.split_type === 'percentage' && (
                  <Text size="sm" c="dimmed">({inviteData.split_value}%)</Text>
                )}
                {inviteData.split_type === 'equal' && (
                  <Text size="sm" c="dimmed">(Split equally)</Text>
                )}
              </Group>
            </div>
          )}

          <div>
            <Text size="sm" c="dimmed" mb={5}>Shared with</Text>
            <Text size="sm">{inviteData?.shared_with_email}</Text>
          </div>

          <Button fullWidth onClick={handleAccept} loading={loading}>
            Accept Invitation
          </Button>

          <Button variant="subtle" fullWidth onClick={() => navigate('/')}>
            Cancel
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
