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
import * as api from '../api/client';
import type { SharedBill, PendingShare } from '../api/client';
import { BillIcon } from './BillIcon';

interface SharedBillsSectionProps {
  onRefresh?: () => void;
}

// Parse date string directly to avoid timezone issues
function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function SharedBillsSection({ onRefresh }: SharedBillsSectionProps) {
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
      setSharedBills(shared);
      setPendingShares(pending);
    } catch (err) {
      console.error('Failed to load shared bills:', err);
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
    } catch (err) {
      console.error('Failed to accept share:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (shareId: number) => {
    setActionLoading(shareId);
    try {
      await api.declineShare(shareId);
      loadData();
    } catch (err) {
      console.error('Failed to decline share:', err);
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
    } catch (err) {
      console.error('Failed to leave share:', err);
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
            <Text fw={600}>Shared Bills</Text>
            <Badge size="sm" variant="light">
              {totalCount}
            </Badge>
          </Group>
          <ActionIcon variant="subtle">
            {expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
          </ActionIcon>
        </Group>

        <Collapse in={expanded}>
          <Stack gap="sm">
            {/* Pending Invitations */}
            {pendingShares.length > 0 && (
              <>
                <Text size="sm" fw={500} c="dimmed">
                  Pending Invitations
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
                            From: {share.owner}
                          </Text>
                          {share.my_portion && (
                            <>
                              <Text size="xs" c="dimmed">
                                |
                              </Text>
                              <Text size="xs" c="dimmed">
                                Your portion: ${share.my_portion.toFixed(2)}
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
                          Accept
                        </Button>
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          leftSection={<IconX size={14} />}
                          onClick={() => handleDecline(share.share_id)}
                          loading={actionLoading === share.share_id}
                        >
                          Decline
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
                    Watching
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
                              {shared.bill.type}
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
                              Due: {formatDate(shared.bill.next_due)}
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
                                ${shared.my_portion.toFixed(2)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                of ${(shared.bill.amount || 0).toFixed(2)}
                              </Text>
                            </>
                          ) : (
                            <Text size="sm" fw={600} c={shared.bill.type === 'deposit' ? 'green' : 'red'}>
                              ${(shared.bill.amount || 0).toFixed(2)}
                            </Text>
                          )}
                        </Stack>

                        {/* Payment Status */}
                        {shared.last_payment ? (
                          <Tooltip label={`Paid on ${formatDate(shared.last_payment.date)}`}>
                            <Badge color="green" leftSection={<IconCash size={12} />}>
                              Paid
                            </Badge>
                          </Tooltip>
                        ) : (
                          <Badge color="gray" variant="light">
                            Unpaid
                          </Badge>
                        )}

                        {/* Leave Button */}
                        <Tooltip label="Stop watching this bill">
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
