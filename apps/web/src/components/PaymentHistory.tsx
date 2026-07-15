import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  Stack,
  Text,
  Group,
  ActionIcon,
  Table,
  NumberInput,
  Button,
  Paper,
  Loader,
  Center,
  Pagination,
  Badge,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconTrash, IconCheck, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Payment, Bill } from '../api/client';
import { getPayments, updatePayment, deletePayment, ApiError } from '../api/client';
import { PaymentHistoryChart } from './PaymentHistoryChart';
import { parseLocalDate, formatDateString, formatDateForAPI } from '../utils/date';
import { formatCurrency, getCurrencyInputProps, getLocale } from '../lib/currency';

interface PaymentHistoryProps {
  opened: boolean;
  onClose: () => void;
  billId: number | null;
  billName: string | null;
  isShared?: boolean;
  shareInfo?: Bill['share_info'] | null;
  onPaymentsChanged: () => void;
}

export function PaymentHistory({
  opened,
  onClose,
  billId,
  billName,
  isShared = false,
  shareInfo = null,
  onPaymentsChanged,
}: PaymentHistoryProps) {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editDate, setEditDate] = useState<Date | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  const fetchPayments = useCallback(async () => {
    if (!billId) return;
    setLoading(true);
    try {
      const response = await getPayments(billId);
      setPayments(Array.isArray(response) ? response : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('paymentHistory.errors.loadFailed');
      notifications.show({
        title: t('paymentHistory.errors.loadFailedTitle'),
        message,
        color: 'red',
      });
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [billId, t]);

  useEffect(() => {
    if (opened && billId) {
      fetchPayments();
      setCurrentPage(1); // Reset page when opening new bill
    }
  }, [opened, billId, fetchPayments]);

  // Paginated payments
  const totalPages = Math.ceil(payments.length / ITEMS_PER_PAGE);
  const paginatedPayments = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return payments.slice(start, start + ITEMS_PER_PAGE);
  }, [payments, currentPage]);

  const handleEdit = (payment: Payment) => {
    setEditingId(payment.id);
    setEditAmount(payment.amount);
    setEditDate(parseLocalDate(payment.payment_date));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
    setEditDate(null);
  };

  const handleSaveEdit = async () => {
    if (editingId === null || editAmount === '' || !editDate) return;

    try {
      await updatePayment(
        editingId,
        editAmount as number,
        formatDateForAPI(editDate)
      );
      notifications.show({
        message: t('paymentHistory.success.updated'),
        color: 'green',
      });
      await fetchPayments();
      onPaymentsChanged();
      handleCancelEdit();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('paymentHistory.errors.updateFailed');
      notifications.show({
        title: t('paymentHistory.errors.updateFailedTitle'),
        message,
        color: 'red',
      });
    }
  };

  const handleDelete = async (paymentId: number) => {
    if (!confirm(t('paymentHistory.confirmDelete'))) return;

    try {
      await deletePayment(paymentId);
      notifications.show({
        message: t('paymentHistory.success.deleted'),
        color: 'green',
      });
      await fetchPayments();
      onPaymentsChanged();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('paymentHistory.errors.deleteFailed');
      notifications.show({
        title: t('paymentHistory.errors.deleteFailedTitle'),
        message,
        color: 'red',
      });
    }
  };


  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <Text>{t('paymentHistory.titlePrefix', { name: billName || '' })}</Text>
          {isShared && shareInfo && (
            <Badge color="violet" variant="filled">
              {t('common.sharedBy', { name: shareInfo.owner_name })}
            </Badge>
          )}
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="md">
        {/* Shared bill info */}
        {isShared && shareInfo && (
          <Paper p="sm" withBorder bg="blue.0">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={500}>
                  {t('paymentHistory.yourPortion', { amount: shareInfo.my_portion !== null ? formatCurrency(shareInfo.my_portion) : t('common.notApplicable') })}
                </Text>
                {shareInfo.my_portion_paid ? (
                  <Badge size="sm" color="green" variant="filled">
                    {t('billModal.paidOn', {
                      date: shareInfo.my_portion_paid_date
                        ? new Date(shareInfo.my_portion_paid_date).toLocaleDateString(getLocale(), {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })
                        : t('paymentHistory.unknownDate')
                    })}
                  </Badge>
                ) : (
                  <Badge size="sm" color="gray" variant="light">
                    {t('paymentHistory.notMarkedPaid')}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {t('paymentHistory.sharedNotice')}
              </Text>
            </Stack>
          </Paper>
        )}

        {/* Payment History Chart */}
        <PaymentHistoryChart billId={billId} />

        {loading ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : payments.length === 0 ? (
          <Paper p="xl" withBorder>
            <Text ta="center" c="dimmed">
              {t('paymentHistory.noPayments')}
            </Text>
          </Paper>
        ) : (
          <>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('common.table.date')}</Table.Th>
                <Table.Th>{t('common.table.amount')}</Table.Th>
                <Table.Th>{t('common.table.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paginatedPayments.map((payment) => (
                <Table.Tr key={payment.id}>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <DatePickerInput
                        value={editDate}
                        onChange={(value) => setEditDate(value ? parseLocalDate(value) : null)}
                        valueFormat={t('common.dateInputFormat')}
                        size="xs"
                        w={140}
                      />
                    ) : (
                      formatDateString(payment.payment_date)
                    )}
                  </Table.Td>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <NumberInput
                        value={editAmount}
                        onChange={(val) => setEditAmount(val === '' ? '' : Number(val))}
                        {...getCurrencyInputProps()}
                        fixedDecimalScale
                        size="xs"
                        w={100}
                      />
                    ) : (
                      <Text fw={500}>{formatCurrency(payment.amount)}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {isShared ? (
                      <Text size="xs" c="dimmed">{t('paymentHistory.readOnly')}</Text>
                    ) : editingId === payment.id ? (
                      <Group gap="xs">
                        <ActionIcon
                          color="green"
                          variant="subtle"
                          onClick={handleSaveEdit}
                          title={t('common.actions.save')}
                        >
                          <IconCheck size={18} />
                        </ActionIcon>
                        <ActionIcon
                          color="gray"
                          variant="subtle"
                          onClick={handleCancelEdit}
                          title={t('common.actions.cancel')}
                        >
                          <IconX size={18} />
                        </ActionIcon>
                      </Group>
                    ) : (
                      <Group gap="xs">
                        <ActionIcon
                          color="blue"
                          variant="subtle"
                          onClick={() => handleEdit(payment)}
                          title={t('common.actions.edit')}
                        >
                          <IconEdit size={18} />
                        </ActionIcon>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => handleDelete(payment.id)}
                          title={t('common.actions.delete')}
                        >
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center" mt="sm">
              <Pagination
                total={totalPages}
                value={currentPage}
                onChange={setCurrentPage}
                size="xs"
              />
            </Group>
          )}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('paymentHistory.close')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
