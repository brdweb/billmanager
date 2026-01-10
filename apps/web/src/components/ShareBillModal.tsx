import { useState, useEffect } from 'react';
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
import * as api from '../api/client';
import type { Bill, BillShare, UserSearchResult } from '../api/client';
import { useConfig } from '../context/ConfigContext';

interface ShareBillModalProps {
  opened: boolean;
  onClose: () => void;
  bill: Bill | null;
}

export function ShareBillModal({ opened, onClose, bill }: ShareBillModalProps) {
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

  // Load existing shares when modal opens
  useEffect(() => {
    if (opened && bill) {
      loadShares();
    }
  }, [opened, bill]);

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

  const loadShares = async () => {
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
  };

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
      setError('Please enter a username' + (isSaas ? ' or email' : ''));
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
      setError(error.message || 'Failed to share bill');
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
      setError(error.message || 'Failed to revoke share');
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
      setSuccess('Split configuration updated');
      setEditingShareId(null);
      setEditSplitType(null);
      setEditSplitValue(undefined);
      loadShares();
    } catch (err) {
      const error = err as { message?: string };
      setError(error.message || 'Failed to update share');
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
          <Text fw={600}>Share Bill: {bill?.name}</Text>
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
              Share with another user
            </Text>

            {isSaas ? (
              <TextInput
                label="Email address"
                placeholder="roommate@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.currentTarget.value)}
                description="They'll receive an email invitation"
              />
            ) : (
              <Autocomplete
                label="Username"
                placeholder="Search for a user..."
                value={identifier}
                onChange={handleSearch}
                data={searchResults.map((u) => u.username)}
                rightSection={searchLoading ? <Loader size="xs" /> : null}
                description="Start typing to search for users"
              />
            )}

            <Select
              label="Split type"
              placeholder="No split (full amount)"
              value={splitType}
              onChange={setSplitType}
              data={[
                { value: 'equal', label: 'Equal (50/50)' },
                { value: 'percentage', label: 'Percentage' },
                { value: 'fixed', label: 'Fixed amount' },
              ]}
              clearable
              description="How to split this bill"
            />

            {splitType === 'percentage' && (
              <NumberInput
                label="Their percentage"
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
                label="Their fixed amount"
                placeholder="0.00"
                value={splitValue}
                onChange={(val) => setSplitValue(typeof val === 'number' ? val : undefined)}
                min={0}
                decimalScale={2}
                prefix="$"
              />
            )}

            {portion !== null && bill?.amount && (
              <Text size="sm" c="dimmed">
                Their portion: ${portion.toFixed(2)} of ${bill.amount.toFixed(2)}
              </Text>
            )}

            <Button
              leftSection={<IconShare size={16} />}
              onClick={handleShare}
              loading={loading}
              disabled={!identifier.trim()}
            >
              Share Bill
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
                Currently shared with
              </Text>
              {shares.map((share) => (
                <div key={share.id}>
                  {editingShareId === share.id ? (
                    // Edit mode
                    <Stack gap="xs" style={{ border: '1px solid var(--mantine-color-blue-4)', borderRadius: '4px', padding: '8px' }}>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>{share.shared_with}</Text>
                        <Badge size="xs" color={getStatusColor(share.status)}>
                          {share.status}
                        </Badge>
                      </Group>

                      <Select
                        label="Split type"
                        placeholder="No split (full amount)"
                        value={editSplitType}
                        onChange={setEditSplitType}
                        data={[
                          { value: 'equal', label: 'Equal (50/50)' },
                          { value: 'percentage', label: 'Percentage' },
                          { value: 'fixed', label: 'Fixed amount' },
                        ]}
                        clearable
                        size="xs"
                      />

                      {editSplitType === 'percentage' && (
                        <NumberInput
                          label="Their percentage"
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
                          label="Their fixed amount"
                          value={editSplitValue}
                          onChange={(val) => setEditSplitValue(typeof val === 'number' ? val : undefined)}
                          min={0}
                          decimalScale={2}
                          prefix="$"
                          size="xs"
                        />
                      )}

                      <Group gap="xs" justify="flex-end">
                        <Button size="xs" variant="default" onClick={handleCancelEdit}>
                          Cancel
                        </Button>
                        <Button size="xs" onClick={() => handleSaveEdit(share.id)} loading={loading}>
                          Save
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    // Normal display mode
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="sm">{share.shared_with}</Text>
                        <Badge size="xs" color={getStatusColor(share.status)}>
                          {share.status}
                        </Badge>
                        {share.split_type && (
                          <Badge size="xs" variant="light">
                            {share.split_type === 'equal'
                              ? '50/50'
                              : share.split_type === 'percentage'
                                ? `${share.split_value}%`
                                : `$${share.split_value?.toFixed(2)}`}
                          </Badge>
                        )}
                      </Group>
                      {share.status !== 'revoked' && (
                        <Group gap={4}>
                          <ActionIcon
                            color="blue"
                            variant="subtle"
                            onClick={() => handleEdit(share)}
                            title="Edit split configuration"
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleRevoke(share.id)}
                            title="Revoke share"
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
            This bill is not shared with anyone yet.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
