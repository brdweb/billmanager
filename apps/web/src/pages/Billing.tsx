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
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';
import type { SubscriptionStatus, BillingUsage } from '../api/client';
import { useConfig } from '../context/ConfigContext';
import { formatCurrencyFor, getLocale } from '../lib/currency';

const PRICING = {
  basic: { monthly: 5, annual: 50 },
  plus: { monthly: 7.5, annual: 75 },
};

export function Billing() {
  const { t } = useTranslation();
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
      setError(t('billingPage.loadFailed'));
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
        setError(t('billingPage.checkoutFailedDefault'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('billingPage.checkoutFailedRetryDefault'));
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
        setError(t('billingPage.portalFailedDefault'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('billingPage.portalFailedRetryDefault'));
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
          {t('billingPage.backToBills')}
        </Button>
        <Title ta="center" mb="lg">{t('billingPage.billingSubscriptionTitle')}</Title>

        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="lg">
            <ThemeIcon size={80} radius="xl" variant="light" color="green">
              <IconServer size={40} />
            </ThemeIcon>
            <Stack align="center" gap="xs">
              <Title order={2}>{t('billingPage.selfHostedTitle')}</Title>
              <Text size="lg" c="dimmed" ta="center">
                {t('billingPage.selfHostedBody')}
              </Text>
            </Stack>
            <Alert color="green" variant="light" w="100%">
              <Text size="sm">
                {t('billingPage.selfHostedAlert')}
              </Text>
            </Alert>
            <Stack gap="xs" w="100%">
              <Text fw={600} size="lg">{t('billingPage.unlimitedFeaturesTitle')}</Text>
              <List
                spacing="sm"
                icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
              >
                <List.Item>{t('billingPage.featureUnlimitedBills')}</List.Item>
                <List.Item>{t('billingPage.featureUnlimitedMembers')}</List.Item>
                <List.Item>{t('billingPage.featureUnlimitedGroups')}</List.Item>
                <List.Item>{t('billingPage.featureFullAnalytics')}</List.Item>
                <List.Item>{t('billingPage.featureExport')}</List.Item>
                <List.Item>{t('billingPage.featureAllIncluded')}</List.Item>
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
        return <Badge color="blue" size="lg">{t('billingPage.statusFreeTrial')}</Badge>;
      }
      return <Badge color="gray" size="lg">{t('billingPage.statusFree')}</Badge>;
    }

    switch (status.status) {
      case 'active':
        return <Badge color="green" size="lg">{t('billingPage.statusActive')}</Badge>;
      case 'trialing':
        return <Badge color="blue" size="lg">{t('billingPage.statusTrial')}</Badge>;
      case 'past_due':
        return <Badge color="yellow" size="lg">{t('billingPage.statusPastDue')}</Badge>;
      case 'canceled':
        return <Badge color="red" size="lg">{t('billingPage.statusCanceled')}</Badge>;
      default:
        return <Badge color="gray" size="lg">{status.status}</Badge>;
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return t('common.notApplicable');
    return new Date(dateString).toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTierName = (tier?: string) => {
    if (!tier) return t('billingPage.tierFree');
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
        {t('billingPage.backToBills')}
      </Button>
      <Title ta="center" mb="lg">{t('billingPage.billingSubscriptionTitle')}</Title>

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
            <Title order={3}>{t('billingPage.currentPlanTitle')}</Title>
          </Group>
          {getStatusBadge()}
        </Group>

        {status?.is_trial_expired && (
          <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light" mb="md">
            {t('billingPage.trialExpiredAlert')}
          </Alert>
        )}

        {status?.is_trialing && !status.is_trial_expired && status.trial_days_remaining !== undefined && (
          <Alert icon={<IconCalendar size={16} />} color="blue" variant="light" mb="md">
            {t('billingPage.trialRemainingAlert', { count: status.trial_days_remaining })}
            {status.trial_days_remaining <= 3 && ` ${t('billingPage.trialRemainingUrgentSuffix')}`}
          </Alert>
        )}

        <Stack gap="xs">
          <Group justify="space-between">
            <Text c="dimmed">{t('billingPage.currentTierLabel')}</Text>
            <Text fw={500}>{formatTierName(status?.effective_tier)}</Text>
          </Group>
          {status?.has_subscription && (
            <>
              <Group justify="space-between">
                <Text c="dimmed">{t('billingPage.billingLabel')}</Text>
                <Text fw={500} tt="capitalize">{status.billing_interval || t('billingPage.monthlyDefault')}</Text>
              </Group>
              {status.current_period_end && (
                <Group justify="space-between">
                  <Text c="dimmed">{t('billingPage.renewsOnLabel')}</Text>
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
              {t('billingPage.manageSubscription')}
            </Button>
          </Group>
        )}
      </Paper>

      {/* Usage Stats */}
      {usage && (
        <Paper withBorder shadow="sm" p="lg" radius="md" mb="lg">
          <Title order={4} mb="md">{t('billingPage.currentUsageTitle')}</Title>
          <SimpleGrid cols={2}>
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm">{t('billingPage.billsLabel')}</Text>
                <Text size="sm" c="dimmed">
                  {usage.usage.bills.unlimited ? t('billingPage.unlimited') : t('billingPage.usedOfLimit', { used: usage.usage.bills.used, limit: usage.usage.bills.limit })}
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
                <Text size="sm">{t('billingPage.billGroupsLabel')}</Text>
                <Text size="sm" c="dimmed">
                  {usage.usage.bill_groups.unlimited ? t('billingPage.unlimited') : t('billingPage.usedOfLimit', { used: usage.usage.bill_groups.used, limit: usage.usage.bill_groups.limit })}
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
                { value: 'monthly', label: t('billingPage.monthlyToggle') },
                { value: 'annual', label: t('billingPage.annualToggle', { percent: getAnnualSavings('basic') }) },
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
                    <Text fw={600} size="lg">{t('billingPage.basicPlan')}</Text>
                  </Group>
                  <Badge color="blue" variant="light">{t('billingPage.popular')}</Badge>
                </Group>
              </Card.Section>

              <Card.Section inheritPadding py="md">
                <Group align="baseline" gap={4}>
                  <Text size="xl" fw={700}>{formatCurrencyFor(billingInterval === 'monthly' ? PRICING.basic.monthly : PRICING.basic.annual, 'USD')}</Text>
                  <Text size="sm" c="dimmed">{billingInterval === 'monthly' ? t('billingPage.perMonth') : t('billingPage.perYear')}</Text>
                </Group>
                {billingInterval === 'annual' && (
                  <Text size="xs" c="dimmed">{t('billingPage.thatsPerMonth', { amount: formatCurrencyFor(PRICING.basic.annual / 12, 'USD') })}</Text>
                )}

                <List
                  spacing="sm"
                  size="sm"
                  mt="md"
                  icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
                >
                  <List.Item>{t('billingPage.basicFeature1')}</List.Item>
                  <List.Item>{t('billingPage.basicFeature2')}</List.Item>
                  <List.Item>{t('billingPage.basicFeature3')}</List.Item>
                  <List.Item>{t('billingPage.basicFeature4')}</List.Item>
                  <List.Item>{t('billingPage.basicFeature5')}</List.Item>
                </List>
              </Card.Section>

              <Button
                fullWidth
                onClick={() => handleSubscribe('basic')}
                loading={actionLoading}
                leftSection={<IconCrown size={16} />}
              >
                {t('billingPage.getBasic')}
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
                    <Text fw={600} size="lg">{t('billingPage.plusPlan')}</Text>
                  </Group>
                  <Badge color="violet">{t('billingPage.bestValue')}</Badge>
                </Group>
              </Card.Section>

              <Card.Section inheritPadding py="md">
                <Group align="baseline" gap={4}>
                  <Text size="xl" fw={700}>{formatCurrencyFor(billingInterval === 'monthly' ? PRICING.plus.monthly : PRICING.plus.annual, 'USD')}</Text>
                  <Text size="sm" c="dimmed">{billingInterval === 'monthly' ? t('billingPage.perMonth') : t('billingPage.perYear')}</Text>
                </Group>
                {billingInterval === 'annual' && (
                  <Text size="xs" c="dimmed">{t('billingPage.thatsPerMonth', { amount: formatCurrencyFor(PRICING.plus.annual / 12, 'USD') })}</Text>
                )}

                <List
                  spacing="sm"
                  size="sm"
                  mt="md"
                  icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
                >
                  <List.Item>{t('billingPage.plusFeature1')}</List.Item>
                  <List.Item>{t('billingPage.plusFeature2')}</List.Item>
                  <List.Item>{t('billingPage.plusFeature3')}</List.Item>
                  <List.Item>{t('billingPage.plusFeature4')}</List.Item>
                  <List.Item>{t('billingPage.plusFeature5')}</List.Item>
                </List>
              </Card.Section>

              <Button
                fullWidth
                color="violet"
                onClick={() => handleSubscribe('plus')}
                loading={actionLoading}
                leftSection={<IconCrown size={16} />}
              >
                {t('billingPage.getPlus')}
              </Button>
            </Card>
          </SimpleGrid>

          <Text size="sm" c="dimmed" ta="center">
            {t('billingPage.trialFooter')}
          </Text>
        </>
      )}

    </Container>
  );
}
