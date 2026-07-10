import { useState, useEffect } from 'react';
import {
  Paper,
  Stack,
  Group,
  Text,
  Badge,
  ActionIcon,
  Button,
  Card,
  Loader,
  Alert,
  Collapse,
  Tooltip,
} from '@mantine/core';
import {
  IconShare,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconX,
  IconUser,
  IconCash,
  IconCalendar,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';
import type { SharedBill, PendingShare } from '../api/client';
import { BillIcon } from './BillIcon';
import { formatCurrency } from '../lib/currency';
import { formatDateString } from '../utils/date';

interface SharedBillsSectionProps {
  onRefresh?: () => void;
}

export function SharedBillsSection({ onRefresh }: SharedBillsSectionProps) {
  const { t } = useTranslation();
  const [sharedBills, setSharedBills] = useState<SharedBill[]>([]);
  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [shared, pending] = await Promise.all([
        api.getSharedBills(),
        api.getPendingShares(),
      ]);
      setSharedBills(Array.isArray(shared) ? shared : []);
      setPendingShares(Array.isArray(pending) ? pending : []);
    } catch {
      // Silently fail - shared bills data is not critical
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (shareId: number) => {
    setActionLoading(shareId);
    try {
      await api.acceptShare(shareId);
      loadData();
      onRefresh?.();
    } catch {
      // Error handling - share accept failed
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (shareId: number) => {
    setActionLoading(shareId);
    try {
      await api.declineShare(shareId);
      loadData();
    } catch {
      // Error handling - share decline failed
    } finally {
      setActionLoading(null);
    }
  };

  const handleLeave = async (shareId: number) => {
    setActionLoading(shareId);
    try {
      await api.leaveShare(shareId);
      loadData();
      onRefresh?.();
    } catch {
      // Error handling - leave share failed
    } finally {
      setActionLoading(null);
    }
  };

  const totalCount = sharedBills.length + pendingShares.length;

  if (loading) {
    return (
      <Paper withBorder p="md">
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      </Paper>
    );
  }

  if (totalCount === 0) {
    return null; // Don't show section if no shared bills
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        {/* Header */}
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Group gap="xs">
            <IconShare size={20} />
            <Text fw={600}>{t('sharedBillsSection.title')}</Text>
            <Badge size="sm" variant="light">
              {totalCount}
            </Badge>
          </Group>
          <ActionIcon variant="subtle">
            {expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
          </ActionIcon>
        </Group>

        <Collapse expanded={expanded}>
          <Stack gap="sm">
            {/* Pending Invitations */}
            {pendingShares.length > 0 && (
              <>
                <Text size="sm" fw={500} c="dimmed">
                  {t('sharedBillsSection.pendingInvitations')}
                </Text>
                {pendingShares.map((share) => (
                  <Alert key={share.share_id} color="yellow" variant="light">
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={4}>
                        <Text size="sm" fw={500}>
                          {share.bill_name}
                        </Text>
                        <Group gap="xs">
                          <IconUser size={14} />
                          <Text size="xs" c="dimmed">
                            {t('sharedBillsSection.fromOwner', { name: share.owner })}
                          </Text>
                          {share.my_portion && (
                            <>
                              <Text size="xs" c="dimmed">
                                |
                              </Text>
                              <Text size="xs" c="dimmed">
                                {t('sharedBillsSection.yourPortion', { amount: formatCurrency(share.my_portion) })}
                              </Text>
                            </>
                          )}
                        </Group>
                      </Stack>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          color="green"
                          leftSection={<IconCheck size={14} />}
                          onClick={() => handleAccept(share.share_id)}
                          loading={actionLoading === share.share_id}
                        >
                          {t('sharedBillsSection.accept')}
                        </Button>
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          leftSection={<IconX size={14} />}
                          onClick={() => handleDecline(share.share_id)}
                          loading={actionLoading === share.share_id}
                        >
                          {t('sharedBillsSection.decline')}
                        </Button>
                      </Group>
                    </Group>
                  </Alert>
                ))}
              </>
            )}

            {/* Active Shared Bills */}
            {sharedBills.length > 0 && (
              <>
                {pendingShares.length > 0 && (
                  <Text size="sm" fw={500} c="dimmed" mt="xs">
                    {t('sharedBillsSection.watching')}
                  </Text>
                )}
                {sharedBills.map((shared) => (
                  <Card key={shared.share_id} withBorder padding="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm">
                        <BillIcon icon={shared.bill.icon} size={32} />
                        <Stack gap={2}>
                          <Group gap="xs">
                            <Text size="sm" fw={500}>
                              {shared.bill.name}
                            </Text>
                            <Badge
                              size="xs"
                              color={shared.bill.type === 'deposit' ? 'green' : 'blue'}
                              variant="light"
                            >
                              {shared.bill.type === 'deposit' ? t('common.billType.deposit') : t('common.billType.expense')}
                            </Badge>
                          </Group>
                          <Group gap="xs">
                            <IconUser size={12} />
                            <Text size="xs" c="dimmed">
                              {shared.owner}
                            </Text>
                            <Text size="xs" c="dimmed">
                              |
                            </Text>
                            <IconCalendar size={12} />
                            <Text size="xs" c="dimmed">
                              {t('sharedBillsSection.dueLabel', { date: formatDateString(shared.bill.next_due) })}
                            </Text>
                          </Group>
                        </Stack>
                      </Group>

                      <Group gap="md">
                        {/* Amount/Portion */}
                        <Stack gap={0} align="flex-end">
                          {shared.my_portion && shared.my_portion !== shared.bill.amount ? (
                            <>
                              <Text size="sm" fw={600} c={shared.bill.type === 'deposit' ? 'green' : 'red'}>
                                {formatCurrency(shared.my_portion)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {t('sharedBillsSection.ofAmount', { amount: formatCurrency(shared.bill.amount || 0) })}
                              </Text>
                            </>
                          ) : (
                            <Text size="sm" fw={600} c={shared.bill.type === 'deposit' ? 'green' : 'red'}>
                              {formatCurrency(shared.bill.amount || 0)}
                            </Text>
                          )}
                        </Stack>

                        {/* Payment Status */}
                        {shared.last_payment ? (
                          <Tooltip label={t('billModal.paidOn', { date: formatDateString(shared.last_payment.date) })}>
                            <Badge color="green" leftSection={<IconCash size={12} />}>
                              {t('sharedBillsSection.paid')}
                            </Badge>
                          </Tooltip>
                        ) : (
                          <Badge color="gray" variant="light">
                            {t('sharedBillsSection.unpaid')}
                          </Badge>
                        )}

                        {/* Leave Button */}
                        <Tooltip label={t('sharedBillsSection.stopWatching')}>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleLeave(shared.share_id)}
                            loading={actionLoading === shared.share_id}
                          >
                            <IconX size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Card>
                ))}
              </>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
