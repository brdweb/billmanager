import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  TextInput,
  Select,
  NumberInput,
  Button,
  Stack,
  Group,
  Text,
  Alert,
  Badge,
  ActionIcon,
  Paper,
  Loader,
  Autocomplete,
} from '@mantine/core';
import { IconShare, IconTrash, IconAlertCircle, IconCheck, IconEdit } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as api from '../api/client';
import type { Bill, BillShare, UserSearchResult } from '../api/client';
import { useConfig } from '../context/ConfigContext';
import {
  formatCurrency,
  getCurrencyInputPlaceholder,
  getCurrencyInputProps,
} from '../lib/currency';

function getStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'accepted':
      return t('shareBillModal.status.accepted');
    case 'pending':
      return t('shareBillModal.status.pending');
    case 'declined':
      return t('shareBillModal.status.declined');
    case 'revoked':
      return t('shareBillModal.status.revoked');
    default:
      return status;
  }
}

interface ShareBillModalProps {
  opened: boolean;
  onClose: () => void;
  bill: Bill | null;
}

export function ShareBillModal({ opened, onClose, bill }: ShareBillModalProps) {
  const { t } = useTranslation();
  const { config } = useConfig();
  const isSaas = config?.deployment_mode === 'saas';

  const [identifier, setIdentifier] = useState('');
  const [splitType, setSplitType] = useState<string | null>(null);
  const [splitValue, setSplitValue] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shares, setShares] = useState<BillShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [editingShareId, setEditingShareId] = useState<number | null>(null);
  const [editSplitType, setEditSplitType] = useState<string | null>(null);
  const [editSplitValue, setEditSplitValue] = useState<number | undefined>(undefined);

  const loadShares = useCallback(async () => {
    if (!bill) return;
    setLoadingShares(true);
    try {
      const result = await api.getBillShares(bill.id);
      setShares(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('Failed to load shares:', err);
      setShares([]);
    } finally {
      setLoadingShares(false);
    }
  }, [bill]);

  // Load existing shares when modal opens
  useEffect(() => {
    if (opened && bill) {
      loadShares();
    }
  }, [opened, bill, loadShares]);

  // Reset form when modal closes
  useEffect(() => {
    if (!opened) {
      setIdentifier('');
      setSplitType(null);
      setSplitValue(undefined);
      setError(null);
      setSuccess(null);
      setSearchResults([]);
    }
  }, [opened]);

  const handleSearch = async (query: string) => {
    setIdentifier(query);
    if (query.length < 2 || isSaas) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const results = await api.searchUsers(query);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleShare = async () => {
    if (!bill || !identifier.trim()) {
      setError(isSaas ? t('shareBillModal.errorUsernameOrEmail') : t('shareBillModal.errorUsername'));
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await api.shareBill(bill.id, {
        identifier: identifier.trim().toLowerCase(),
        split_type: splitType as 'percentage' | 'fixed' | 'equal' | null,
        split_value: splitValue,
      });

      setSuccess(result.message);
      setIdentifier('');
      setSplitType(null);
      setSplitValue(undefined);
      loadShares();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('shareBillModal.shareFailedDefault'));
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (shareId: number) => {
    try {
      await api.revokeShare(shareId);
      loadShares();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('shareBillModal.revokeFailedDefault'));
    }
  };

  const handleEdit = (share: BillShare) => {
    setEditingShareId(share.id);
    setEditSplitType(share.split_type);
    setEditSplitValue(share.split_value ?? undefined);
    setError(null);
    setSuccess(null);
  };

  const handleCancelEdit = () => {
    setEditingShareId(null);
    setEditSplitType(null);
    setEditSplitValue(undefined);
  };

  const handleSaveEdit = async (shareId: number) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await api.updateShare(shareId, {
        split_type: editSplitType,
        split_value: editSplitValue ?? null,
      });
      setSuccess(t('shareBillModal.splitUpdated'));
      setEditingShareId(null);
      setEditSplitType(null);
      setEditSplitValue(undefined);
      loadShares();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || t('shareBillModal.updateFailedDefault'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'green';
      case 'pending':
        return 'yellow';
      case 'declined':
        return 'red';
      case 'revoked':
        return 'gray';
      default:
        return 'gray';
    }
  };

  const calculatePortion = () => {
    if (!bill?.amount) return null;
    if (!splitType) return bill.amount;
    if (splitType === 'equal') return bill.amount / 2;
    if (splitType === 'percentage' && splitValue) return bill.amount * (splitValue / 100);
    if (splitType === 'fixed' && splitValue) return Math.min(splitValue, bill.amount);
    return bill.amount;
  };

  const portion = calculatePortion();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconShare size={20} />
          <Text fw={600}>{t('shareBillModal.titlePrefix', { name: bill?.name })}</Text>
        </Group>
      }
      size="md"
    >
      <Stack gap="sm">
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert color="green" icon={<IconCheck size={16} />}>
            {success}
          </Alert>
        )}

        {/* Share Form */}
        <Paper withBorder p="sm">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {t('shareBillModal.shareWithUser')}
            </Text>

            {isSaas ? (
              <TextInput
                label={t('shareBillModal.emailLabel')}
                placeholder={t('shareBillModal.emailPlaceholder')}
                value={identifier}
                onChange={(e) => setIdentifier(e.currentTarget.value)}
                description={t('shareBillModal.emailDescription')}
              />
            ) : (
              <Autocomplete
                label={t('shareBillModal.usernameLabel')}
                placeholder={t('shareBillModal.usernamePlaceholder')}
                value={identifier}
                onChange={handleSearch}
                data={searchResults.map((u) => u.username)}
                rightSection={searchLoading ? <Loader size="xs" /> : null}
                description={t('shareBillModal.usernameDescription')}
              />
            )}

            <Select
              label={t('shareBillModal.splitTypeLabel')}
              placeholder={t('shareBillModal.splitTypePlaceholder')}
              value={splitType}
              onChange={setSplitType}
              data={[
                { value: 'equal', label: t('shareBillModal.splitTypeEqual') },
                { value: 'percentage', label: t('shareBillModal.splitTypePercentage') },
                { value: 'fixed', label: t('shareBillModal.splitTypeFixed') },
              ]}
              clearable
              description={t('shareBillModal.splitTypeDescription')}
            />

            {splitType === 'percentage' && (
              <NumberInput
                label={t('shareBillModal.theirPercentageLabel')}
                placeholder="50"
                value={splitValue}
                onChange={(val) => setSplitValue(typeof val === 'number' ? val : undefined)}
                min={0}
                max={100}
                suffix="%"
              />
            )}

            {splitType === 'fixed' && (
              <NumberInput
                label={t('shareBillModal.theirFixedLabel')}
                placeholder={getCurrencyInputPlaceholder()}
                value={splitValue}
                onChange={(val) => setSplitValue(typeof val === 'number' ? val : undefined)}
                min={0}
                {...getCurrencyInputProps()}
              />
            )}

            {portion !== null && bill?.amount && (
              <Text size="sm" c="dimmed">
                {t('shareBillModal.theirPortion', { portion: formatCurrency(portion), total: formatCurrency(bill.amount) })}
              </Text>
            )}

            <Button
              leftSection={<IconShare size={16} />}
              onClick={handleShare}
              loading={loading}
              disabled={!identifier.trim()}
            >
              {t('shareBillModal.shareBillButton')}
            </Button>
          </Stack>
        </Paper>

        {/* Existing Shares */}
        {loadingShares ? (
          <Group justify="center" p="sm">
            <Loader size="sm" />
          </Group>
        ) : shares.length > 0 ? (
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                {t('shareBillModal.currentlySharedWith')}
              </Text>
              {shares.map((share) => (
                <div key={share.id}>
                  {editingShareId === share.id ? (
                    // Edit mode
                    <Stack gap="xs" style={{ border: '1px solid var(--mantine-color-blue-4)', borderRadius: '4px', padding: '8px' }}>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>{share.shared_with}</Text>
                        <Badge size="xs" color={getStatusColor(share.status)}>
                          {getStatusLabel(share.status, t)}
                        </Badge>
                      </Group>

                      <Select
                        label={t('shareBillModal.splitTypeLabel')}
                        placeholder={t('shareBillModal.splitTypePlaceholder')}
                        value={editSplitType}
                        onChange={setEditSplitType}
                        data={[
                          { value: 'equal', label: t('shareBillModal.splitTypeEqual') },
                          { value: 'percentage', label: t('shareBillModal.splitTypePercentage') },
                          { value: 'fixed', label: t('shareBillModal.splitTypeFixed') },
                        ]}
                        clearable
                        size="xs"
                      />

                      {editSplitType === 'percentage' && (
                        <NumberInput
                          label={t('shareBillModal.theirPercentageLabel')}
                          value={editSplitValue}
                          onChange={(val) => setEditSplitValue(typeof val === 'number' ? val : undefined)}
                          min={0}
                          max={100}
                          suffix="%"
                          size="xs"
                        />
                      )}

                      {editSplitType === 'fixed' && (
                        <NumberInput
                          label={t('shareBillModal.theirFixedLabel')}
                          value={editSplitValue}
                          onChange={(val) => setEditSplitValue(typeof val === 'number' ? val : undefined)}
                          min={0}
                          {...getCurrencyInputProps()}
                          size="xs"
                        />
                      )}

                      <Group gap="xs" justify="flex-end">
                        <Button size="xs" variant="default" onClick={handleCancelEdit}>
                          {t('common.actions.cancel')}
                        </Button>
                        <Button size="xs" onClick={() => handleSaveEdit(share.id)} loading={loading}>
                          {t('common.actions.save')}
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    // Normal display mode
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="sm">{share.shared_with}</Text>
                        <Badge size="xs" color={getStatusColor(share.status)}>
                          {getStatusLabel(share.status, t)}
                        </Badge>
                        {share.split_type && (
                          <Badge size="xs" variant="light">
                            {share.split_type === 'equal'
                              ? '50/50'
                              : share.split_type === 'percentage'
                                ? `${share.split_value}%`
                                : formatCurrency(share.split_value)}
                          </Badge>
                        )}
                      </Group>
                      {share.status !== 'revoked' && (
                        <Group gap={4}>
                          <ActionIcon
                            color="blue"
                            variant="subtle"
                            onClick={() => handleEdit(share)}
                            title={t('shareBillModal.editSplitConfig')}
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleRevoke(share.id)}
                            title={t('shareBillModal.revokeShare')}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Group>
                  )}
                </div>
              ))}
            </Stack>
          </Paper>
        ) : (
          <Text size="sm" c="dimmed" ta="center">
            {t('shareBillModal.notSharedYet')}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
