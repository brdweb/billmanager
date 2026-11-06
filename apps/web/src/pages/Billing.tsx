import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { useAuth } from '../context/AuthContext';
import { formatCurrencyFor, getLocale } from '../lib/currency';
import { isPaidPro, useCheckoutActivation } from '../hooks/useCheckoutActivation';
import {
  CheckoutCanceledNotice,
  CheckoutSuccessNotice,
  ProRenewalDisclosure,
} from '../components/Billing/CheckoutNotices';

const PRICING = {
  pro: { monthly: 2.99, annual: 24 },
};

// Stripe statuses that can never bill again; the server accepts a new checkout for them.
const TERMINAL_SUBSCRIPTION_STATUSES: Record<string, true> = { canceled: true, incomplete_expired: true };

// Localize the server's refusal for a subscription that must be resolved before checkout.
const checkoutRefusalKey = (err: unknown, canManage: boolean) =>
  (err as { code?: unknown } | null)?.code === 'subscription_needs_attention'
    ? canManage ? 'billingPage.checkoutNeedsAttentionPortal' : 'billingPage.checkoutNeedsAttention'
    : null;

export function Billing({ checkoutResult }: { checkoutResult?: 'success' | 'cancel' } = {}) {
  const { t } = useTranslation();
  const { isSelfHosted } = useConfig();
  // Only the account owner can open the billing portal (server can_manage_subscription), so
  // only the owner is offered a purchase whose disclosure promises cancellation there.
  const { isAdmin: isAccountOwner } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');
  const [checkoutConfirmed, setCheckoutConfirmed] = useState(false);

  const fetchData = useCallback(async () => {
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
  }, [t]);

  useEffect(() => {
    // Self-hosted servers don't have subscription management
    if (isSelfHosted) {
      setLoading(false);
      return;
    }
    void fetchData();
  }, [fetchData, isSelfHosted]);

  // Stripe returns to /billing/success?session_id=...; without it, show the normal page.
  const awaitingCheckout = checkoutResult === 'success' && !isSelfHosted && searchParams.has('session_id');
  const paidPro = isPaidPro(status);
  const handlePolledStatus = useCallback((next: SubscriptionStatus) => {
    setStatus(next);
    if (isPaidPro(next)) {
      api.getBillingUsage().then(setUsage).catch(() => undefined);
    }
  }, []);
  const activation = useCheckoutActivation(
    awaitingCheckout && !loading && !paidPro,
    handlePolledStatus
  );

  // Once Pro is confirmed, drop session_id so a reload or Back does not replay activation.
  useEffect(() => {
    if (!awaitingCheckout || !paidPro) return;
    setCheckoutConfirmed(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('session_id');
      return next;
    }, { replace: true });
  }, [awaitingCheckout, paidPro, setSearchParams]);

  const handleSubscribe = async (tier: 'pro') => {
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
      const refusal = checkoutRefusalKey(err, status?.can_manage_subscription === true);
      setError(refusal ? t(refusal) : err instanceof Error ? err.message : t('billingPage.checkoutFailedRetryDefault'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    if (status?.can_manage_subscription !== true) return;
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

  // A canceled checkout leaves a 'pending' row for users who had none; it is not a subscription.
  const hasSubscription = status?.has_subscription === true && status.status !== 'pending';
  // Ended subscriptions can never bill again, so they have no renewal date.
  const subscriptionEnded = hasSubscription && TERMINAL_SUBSCRIPTION_STATUSES[status?.status ?? ''] === true;
  // Free users, trial subscribers and returning customers whose subscription ended can check out;
  // other stored subscriptions are resolved through the portal.
  const canStartCheckout = !hasSubscription || status?.is_trialing === true || subscriptionEnded;

  const getStatusBadge = () => {
    if (!hasSubscription) {
      if (status?.is_trialing) {
        return <Badge color="blue" size="lg">{t('billingPage.statusFreeTrial')}</Badge>;
      }
      return <Badge color="gray" size="lg">{t('billingPage.statusFree')}</Badge>;
    }

    switch (status?.status) {
      case 'active':
        return <Badge color="green" size="lg">{t('billingPage.statusActive')}</Badge>;
      case 'trialing':
        return <Badge color="blue" size="lg">{t('billingPage.statusTrial')}</Badge>;
      case 'past_due':
        return <Badge color="yellow" size="lg">{t('billingPage.statusPastDue')}</Badge>;
      case 'canceled':
        return <Badge color="red" size="lg">{t('billingPage.statusCanceled')}</Badge>;
      default:
        return <Badge color="gray" size="lg">{status?.status}</Badge>;
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

  const getAnnualSavings = (tier: 'pro') => {
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

      {(awaitingCheckout || checkoutConfirmed) && (
        <CheckoutSuccessNotice active={paidPro || checkoutConfirmed} timedOut={activation.timedOut} onRetry={activation.retry} />
      )}
      {checkoutResult === 'cancel' && <CheckoutCanceledNotice />}

      {/* Current Plan Status */}
      <Paper withBorder shadow="md" p="lg" radius="md" mb="lg">
        <Group justify="space-between" mb="md">
          <Group>
            <IconCreditCard size={24} />
            <Title order={3}>{t('billingPage.currentPlanTitle')}</Title>
          </Group>
          {getStatusBadge()}
        </Group>

        {/* Do not prompt for another purchase while a completed checkout activates. */}
        {status?.is_trial_expired && !awaitingCheckout && (
          <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light" mb="md">
            {t('billingPage.trialExpiredAlert')}
          </Alert>
        )}

        {status?.is_trialing && !status.is_trial_expired && status.trial_days_remaining !== undefined && !awaitingCheckout && (
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
          {hasSubscription && status && (
            <>
              <Group justify="space-between">
                <Text c="dimmed">{t('billingPage.billingLabel')}</Text>
                <Text fw={500} tt="capitalize">{status.billing_interval || t('billingPage.monthlyDefault')}</Text>
              </Group>
              {status.current_period_end && !subscriptionEnded && (
                <Group justify="space-between">
                  <Text c="dimmed">{t(status.cancel_at_period_end ? 'billingPage.cancelsOnLabel' : 'billingPage.renewsOnLabel')}</Text>
                  <Text fw={500}>{formatDate(status.current_period_end)}</Text>
                </Group>
              )}
            </>
          )}
        </Stack>

        {status?.can_manage_subscription === true && (
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

      {/* Pricing is available when checkout is allowed, but not while a purchase activates. */}
      {canStartCheckout && !awaitingCheckout && (
        <>
          <Group justify="center" mb="lg">
            <SegmentedControl
              value={billingInterval}
              onChange={(v) => setBillingInterval(v as 'monthly' | 'annual')}
              data={[
                { value: 'monthly', label: t('billingPage.monthlyToggle') },
                { value: 'annual', label: t('billingPage.annualToggle', { percent: getAnnualSavings('pro') }) },
              ]}
            />
          </Group>

          <SimpleGrid cols={1} spacing="lg" mb="lg">
            {/* Pro Plan */}
            <Card withBorder shadow="sm" radius="md" padding="lg">
              <Card.Section withBorder inheritPadding py="xs">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" color="blue" size="lg">
                      <IconRocket size={20} />
                    </ThemeIcon>
                    <Text fw={600} size="lg">{t('billingPage.proPlan')}</Text>
                  </Group>
                  <Badge color="blue" variant="light">{t('billingPage.popular')}</Badge>
                </Group>
              </Card.Section>

              <Card.Section inheritPadding py="md">
                <Group align="baseline" gap={4}>
                  <Text size="xl" fw={700}>{formatCurrencyFor(billingInterval === 'monthly' ? PRICING.pro.monthly : PRICING.pro.annual, 'USD')}</Text>
                  <Text size="sm" c="dimmed">{billingInterval === 'monthly' ? t('billingPage.perMonth') : t('billingPage.perYear')}</Text>
                </Group>
                {billingInterval === 'annual' && (
                  <Text size="xs" c="dimmed">{t('billingPage.thatsPerMonth', { amount: formatCurrencyFor(PRICING.pro.annual / 12, 'USD') })}</Text>
                )}

                <List
                  spacing="sm"
                  size="sm"
                  mt="md"
                  icon={<IconCheck size={16} color="var(--mantine-color-green-6)" />}
                >
                  <List.Item>{t('billingPage.proFeature1')}</List.Item>
                  <List.Item>{t('billingPage.proFeature2')}</List.Item>
                  <List.Item>{t('billingPage.proFeature3')}</List.Item>
                  <List.Item>{t('billingPage.proFeature4')}</List.Item>
                  <List.Item>{t('billingPage.proFeature5')}</List.Item>
                </List>
              </Card.Section>

              {isAccountOwner ? (
                <>
                  <ProRenewalDisclosure
                    interval={billingInterval}
                    price={formatCurrencyFor(billingInterval === 'monthly' ? PRICING.pro.monthly : PRICING.pro.annual, 'USD')}
                  />
                  <Button
                    fullWidth
                    onClick={() => handleSubscribe('pro')}
                    loading={actionLoading}
                    leftSection={<IconCrown size={16} />}
                  >
                    {t('billingPage.getPro')}
                  </Button>
                </>
              ) : (
                <Text size="sm" c="dimmed" ta="center" data-testid="pro-owner-only">
                  {t('billingPage.ownerOnlyPurchase')}
                </Text>
              )}
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
