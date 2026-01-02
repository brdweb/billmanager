import { useState, useEffect } from 'react';
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
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconEdit, IconTrash, IconCheck, IconX } from '@tabler/icons-react';
import type { Payment } from '../api/client';
import { getPayments, updatePayment, deletePayment } from '../api/client';
import { PaymentHistoryChart } from './PaymentHistoryChart';
import { parseLocalDate, formatDateString, formatDateForAPI } from '../utils/date';

interface PaymentHistoryProps {
  opened: boolean;
  onClose: () => void;
  billId: number | null;
  billName: string | null;
  onPaymentsChanged: () => void;
}

export function PaymentHistory({
  opened,
  onClose,
  billId,
  billName,
  onPaymentsChanged,
}: PaymentHistoryProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editDate, setEditDate] = useState<Date | null>(null);

  useEffect(() => {
    if (opened && billId) {
      fetchPayments();
    }
  }, [opened, billId]);

  const fetchPayments = async () => {
    if (!billId) return;
    setLoading(true);
    try {
      const response = await getPayments(billId);
      setPayments(response);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoading(false);
    }
  };

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
      await fetchPayments();
      onPaymentsChanged();
      handleCancelEdit();
    } catch (error) {
      console.error('Failed to update payment:', error);
    }
  };

  const handleDelete = async (paymentId: number) => {
    if (!confirm('Are you sure you want to delete this payment?')) return;

    try {
      await deletePayment(paymentId);
      await fetchPayments();
      onPaymentsChanged();
    } catch (error) {
      console.error('Failed to delete payment:', error);
    }
  };


  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Payment History: ${billName || ''}`}
      size="lg"
      centered
    >
      <Stack gap="md">
        {/* Payment History Chart */}
        <PaymentHistoryChart billName={billName} />

        {loading ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : payments.length === 0 ? (
          <Paper p="xl" withBorder>
            <Text ta="center" c="dimmed">
              No payments recorded yet
            </Text>
          </Paper>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {payments.map((payment) => (
                <Table.Tr key={payment.id}>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <DatePickerInput
                        value={editDate}
                        onChange={(value) => setEditDate(value ? new Date(value) : null)}
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
                        prefix="$"
                        decimalScale={2}
                        fixedDecimalScale
                        size="xs"
                        w={100}
                      />
                    ) : (
                      <Text fw={500}>${payment.amount.toFixed(2)}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <Group gap="xs">
                        <ActionIcon
                          color="green"
                          variant="subtle"
                          onClick={handleSaveEdit}
                          title="Save"
                        >
                          <IconCheck size={18} />
                        </ActionIcon>
                        <ActionIcon
                          color="gray"
                          variant="subtle"
                          onClick={handleCancelEdit}
                          title="Cancel"
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
                          title="Edit"
                        >
                          <IconEdit size={18} />
                        </ActionIcon>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => handleDelete(payment.id)}
                          title="Delete"
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
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
