import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Stack,
  Alert,
  Badge,
  Group,
  Card,
  List,
  Loader,
  Center,
  SegmentedControl,
  SimpleGrid,
  Progress,
  ThemeIcon,
} from '@mantine/core';
import {
  IconCreditCard,
  IconCheck,
  IconAlertCircle,
  IconCrown,
  IconCalendar,
  IconRocket,
  IconArrowLeft,
  IconServer,
} from '@tabler/icons-react';
import * as api from '../api/client';
import type { SubscriptionStatus, BillingUsage } from '../api/client';
import { useConfig } from '../context/ConfigContext';

const PRICING = {
  basic: { monthly: 5, annual: 50 },
  plus: { monthly: 7.5, annual: 75 },
};

export function Billing() {
  const { isSelfHosted } = useConfig();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    // Self-hosted servers don't have subscription management
    if (isSelfHosted) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [isSelfHosted]);

  const fetchData = async () => {
    try {
      const [statusRes, usageRes] = await Promise.all([
        api.getSubscriptionStatus(),
        api.getBillingUsage(),
      ]);
      setStatus(statusRes);
      setUsage(usageRes);
    } catch {
      setError('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (tier: 'basic' | 'plus') => {
    setActionLoading(true);
    try {
      const response = await api.createCheckoutSession(tier, billingInterval);
      if (response.url) {
        window.umami?.track('checkout_started', { tier, interval: billingInterval });
        window.location.href = response.url;
      } else {
        setError('Failed to create checkout session');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start subscription process');
    } finally {
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    setActionLoading(true);
    try {
      const response = await api.createPortalSession();
      if (response.url) {
        window.location.href = response.url;
      } else {
        setError('Failed to open billing portal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Container size="md" my={40}>
        <Center py="xl">
          <Loader size="lg" />
        </Center>
      </Container>
    );
  }

  // Self-hosted servers don't need subscription management
  if (isSelfHosted) {
    return (
      <Container size="md" my={40}>
        <Button
          component={Link}
          to="/"
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          mb="md"
        >
          Back to Bills
        </Button>
        <Title ta="center" mb="lg">Billing & Subscription</Title>

        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="lg">
            <ThemeIcon size={80} radius="xl" variant="light" color="green">
              <IconServer size={40} />
            </ThemeIcon>
            <Stack align="center" gap="xs">
              <Title order={2}>Self-Hosted Instance</Title>
              <Text size="lg" c="dimmed" ta="center">
                You are connected to a self-hosted BillManager server.
              </Text>
            </Stack>
            <Alert color="green" variant="light" w="100%">
              <Text size="sm">
                Subscription management is only available for BillManager Cloud users.
                Self-hosted servers have unlimited access to all features at no additional cost.
              </Text>
            </Alert>
            <Stack gap="xs" w="100%">
              <Text fw={600} size="lg">Unlimited Features Include:</Text>
              <List
                spacing="sm"
                icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
              >
                <List.Item>Unlimited bills and income tracking</List.Item>
                <List.Item>Unlimited family members and users</List.Item>
                <List.Item>Unlimited bill groups</List.Item>
                <List.Item>Full analytics and reporting</List.Item>
                <List.Item>Export to CSV/PDF</List.Item>
                <List.Item>All features included forever</List.Item>
              </List>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const getStatusBadge = () => {
    if (!status?.has_subscription) {
      if (status?.is_trialing) {
        return <Badge color="blue" size="lg">Free Trial</Badge>;
      }
      return <Badge color="gray" size="lg">Free</Badge>;
    }

    switch (status.status) {
      case 'active':
        return <Badge color="green" size="lg">Active</Badge>;
      case 'trialing':
        return <Badge color="blue" size="lg">Trial</Badge>;
      case 'past_due':
        return <Badge color="yellow" size="lg">Past Due</Badge>;
      case 'canceled':
        return <Badge color="red" size="lg">Canceled</Badge>;
      default:
        return <Badge color="gray" size="lg">{status.status}</Badge>;
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTierName = (tier?: string) => {
    if (!tier) return 'Free';
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  };

  const getAnnualSavings = (tier: 'basic' | 'plus') => {
    const monthly = PRICING[tier].monthly * 12;
    const annual = PRICING[tier].annual;
    return Math.round((1 - annual / monthly) * 100);
  };

  return (
    <Container size="md" my={40}>
      <Button
        component={Link}
        to="/"
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        mb="md"
      >
        Back to Bills
      </Button>
      <Title ta="center" mb="lg">Billing & Subscription</Title>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" mb="lg" onClose={() => setError('')} withCloseButton>
          {error}
        </Alert>
      )}

      {/* Current Plan Status */}
      <Paper withBorder shadow="md" p="lg" radius="md" mb="lg">
        <Group justify="space-between" mb="md">
          <Group>
            <IconCreditCard size={24} />
            <Title order={3}>Current Plan</Title>
          </Group>
          {getStatusBadge()}
        </Group>

        {status?.is_trial_expired && (
          <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light" mb="md">
            Your trial has expired. Subscribe to continue with full features.
          </Alert>
        )}

        {status?.is_trialing && !status.is_trial_expired && status.trial_days_remaining !== undefined && (
          <Alert icon={<IconCalendar size={16} />} color="blue" variant="light" mb="md">
            You have {status.trial_days_remaining} days remaining in your free trial.
            {status.trial_days_remaining <= 3 && ' Subscribe now to keep your data!'}
          </Alert>
        )}

        <Stack gap="xs">
          <Group justify="space-between">
            <Text c="dimmed">Current Tier</Text>
            <Text fw={500}>{formatTierName(status?.effective_tier)}</Text>
          </Group>
          {status?.has_subscription && (
            <>
              <Group justify="space-between">
                <Text c="dimmed">Billing</Text>
                <Text fw={500} tt="capitalize">{status.billing_interval || 'Monthly'}</Text>
              </Group>
              {status.current_period_end && (
                <Group justify="space-between">
                  <Text c="dimmed">Renews on</Text>
                  <Text fw={500}>{formatDate(status.current_period_end)}</Text>
                </Group>
              )}
            </>
          )}
        </Stack>

        {status?.has_subscription && (
          <Group mt="lg">
            <Button
              leftSection={<IconCreditCard size={16} />}
              onClick={handleManage}
              loading={actionLoading}
            >
              Manage Subscription
            </Button>
          </Group>
        )}
      </Paper>

      {/* Usage Stats */}
      {usage && (
        <Paper withBorder shadow="sm" p="lg" radius="md" mb="lg">
          <Title order={4} mb="md">Current Usage</Title>
          <SimpleGrid cols={2}>
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm">Bills</Text>
                <Text size="sm" c="dimmed">
                  {usage.usage.bills.unlimited ? 'Unlimited' : `${usage.usage.bills.used} / ${usage.usage.bills.limit}`}
                </Text>
              </Group>
              {!usage.usage.bills.unlimited && (
                <Progress
                  value={(usage.usage.bills.used / usage.usage.bills.limit) * 100}
                  color={usage.usage.bills.used >= usage.usage.bills.limit ? 'red' : 'green'}
                  size="sm"
                />
              )}
            </div>
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm">Bill Groups</Text>
                <Text size="sm" c="dimmed">
                  {usage.usage.bill_groups.unlimited ? 'Unlimited' : `${usage.usage.bill_groups.used} / ${usage.usage.bill_groups.limit}`}
                </Text>
              </Group>
              {!usage.usage.bill_groups.unlimited && (
                <Progress
                  value={(usage.usage.bill_groups.used / usage.usage.bill_groups.limit) * 100}
                  color={usage.usage.bill_groups.used >= usage.usage.bill_groups.limit ? 'red' : 'green'}
                  size="sm"
                />
              )}
            </div>
          </SimpleGrid>
        </Paper>
      )}

      {/* Pricing Plans - Only show if not subscribed */}
      {!status?.has_subscription && (
        <>
          <Group justify="center" mb="lg">
            <SegmentedControl
              value={billingInterval}
              onChange={(v) => setBillingInterval(v as 'monthly' | 'annual')}
              data={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: `Annual (Save ${getAnnualSavings('basic')}%)` },
              ]}
            />
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mb="lg">
            {/* Basic Plan */}
            <Card withBorder shadow="sm" radius="md" padding="lg">
              <Card.Section withBorder inheritPadding py="xs">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" color="blue" size="lg">
                      <IconRocket size={20} />
                    </ThemeIcon>
                    <Text fw={600} size="lg">Basic</Text>
                  </Group>
                  <Badge color="blue" variant="light">Popular</Badge>
                </Group>
              </Card.Section>

              <Card.Section inheritPadding py="md">
                <Group align="baseline" gap={4}>
                  <Text size="xl" fw={700}>${billingInterval === 'monthly' ? PRICING.basic.monthly : PRICING.basic.annual}</Text>
                  <Text size="sm" c="dimmed">/{billingInterval === 'monthly' ? 'month' : 'year'}</Text>
                </Group>
                {billingInterval === 'annual' && (
                  <Text size="xs" c="dimmed">That's ${(PRICING.basic.annual / 12).toFixed(2)}/month</Text>
                )}

                <List
                  spacing="sm"
                  size="sm"
                  mt="md"
                  icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
                >
                  <List.Item>Unlimited bills & income</List.Item>
                  <List.Item>Up to 2 family members</List.Item>
                  <List.Item>1 bill group</List.Item>
                  <List.Item>Export to CSV/PDF</List.Item>
                  <List.Item>Full analytics</List.Item>
                </List>
              </Card.Section>

              <Button
                fullWidth
                onClick={() => handleSubscribe('basic')}
                loading={actionLoading}
                leftSection={<IconCrown size={16} />}
              >
                Get Basic
              </Button>
            </Card>

            {/* Plus Plan */}
            <Card withBorder shadow="sm" radius="md" padding="lg" style={{ borderColor: 'var(--mantine-color-violet-5)', borderWidth: 2 }}>
              <Card.Section withBorder inheritPadding py="xs">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" color="violet" size="lg">
                      <IconCrown size={20} />
                    </ThemeIcon>
                    <Text fw={600} size="lg">Plus</Text>
                  </Group>
                  <Badge color="violet">Best Value</Badge>
                </Group>
              </Card.Section>

              <Card.Section inheritPadding py="md">
                <Group align="baseline" gap={4}>
                  <Text size="xl" fw={700}>${billingInterval === 'monthly' ? PRICING.plus.monthly : PRICING.plus.annual}</Text>
                  <Text size="sm" c="dimmed">/{billingInterval === 'monthly' ? 'month' : 'year'}</Text>
                </Group>
                {billingInterval === 'annual' && (
                  <Text size="xs" c="dimmed">That's ${(PRICING.plus.annual / 12).toFixed(2)}/month</Text>
                )}

                <List
                  spacing="sm"
                  size="sm"
                  mt="md"
                  icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
                >
                  <List.Item>Everything in Basic</List.Item>
                  <List.Item>Up to 5 family members</List.Item>
                  <List.Item>3 bill groups</List.Item>
                  <List.Item>Priority support</List.Item>
                  <List.Item>Early access to new features</List.Item>
                </List>
              </Card.Section>

              <Button
                fullWidth
                color="violet"
                onClick={() => handleSubscribe('plus')}
                loading={actionLoading}
                leftSection={<IconCrown size={16} />}
              >
                Get Plus
              </Button>
            </Card>
          </SimpleGrid>

          <Text size="sm" c="dimmed" ta="center">
            14-day free trial included. Cancel anytime.
          </Text>
        </>
      )}

    </Container>
  );
}
