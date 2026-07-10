import { useState, useEffect } from 'react';
import {
  Modal,
  NumberInput,
  Switch,
  Button,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Bill } from '../api/client';
import {
  getCurrencyInputPlaceholder,
  getCurrencyInputProps,
} from '../lib/currency';

interface PayModalProps {
  opened: boolean;
  onClose: () => void;
  onPay: (amount: number, advanceDue: boolean) => Promise<void>;
  bill: Bill | null;
}

export function PayModal({ opened, onClose, onPay, bill }: PayModalProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState<number | ''>('');
  const [advanceDue, setAdvanceDue] = useState(true);
  const [loading, setLoading] = useState(false);

  const isDeposit = bill?.type === 'deposit';

  useEffect(() => {
    if (bill && opened) {
      setAmount(bill.amount || '');
      setAdvanceDue(true);
    }
  }, [bill, opened]);

  const handleSubmit = async () => {
    if (amount === '' || amount < 0) {
      return;
    }

    setLoading(true);
    try {
      await onPay(amount as number, advanceDue);
      window.umami?.track('payment_recorded', { type: isDeposit ? 'deposit' : 'expense' });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isDeposit
        ? t('payModal.titleRecord', { name: bill?.name || t('payModal.billFallback') })
        : t('payModal.titlePay', { name: bill?.name || t('payModal.billFallback') })}
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {isDeposit ? t('payModal.descriptionDeposit') : t('payModal.descriptionPayment')}
        </Text>

        <NumberInput
          label={isDeposit ? t('payModal.depositAmountLabel') : t('payModal.paymentAmountLabel')}
          placeholder={getCurrencyInputPlaceholder()}
          {...getCurrencyInputProps()}
          fixedDecimalScale
          min={0}
          value={amount}
          onChange={(val) => setAmount(val === '' ? '' : Number(val))}
          description={bill?.varies ? (isDeposit ? t('payModal.variableAmountDeposit') : t('payModal.variableAmountBill')) : undefined}
        />

        <Switch
          label={t('payModal.advanceDueLabel')}
          description={isDeposit ? t('payModal.advanceDueDescDeposit') : t('payModal.advanceDueDescBill')}
          checked={advanceDue}
          onChange={(event) => setAdvanceDue(event.currentTarget.checked)}
        />

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            color={isDeposit ? 'green' : 'blue'}
            onClick={handleSubmit}
            loading={loading}
            disabled={amount === '' || (typeof amount === 'number' && amount < 0)}
          >
            {isDeposit ? t('payModal.recordDeposit') : t('payModal.recordPayment')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
