import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { SharedBill, PendingShare } from '../types';
import { BillIcon } from '../components/BillIcon';

const formatCurrency = (amount: number | null): string => {
  if (amount === null) return 'Variable';
  return `$${amount.toFixed(2)}`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

const getDaysUntil = (dateStr: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(dateStr + 'T00:00:00');
  const diffTime = dueDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const getSplitLabel = (splitType: string | null, splitValue: number | null): string => {
  if (!splitType) return '';
  switch (splitType) {
    case 'percentage':
      return `${splitValue}%`;
    case 'fixed':
      return `$${splitValue?.toFixed(2)}`;
    case 'equal':
      return '50/50';
    default:
      return '';
  }
};

export default function SharedBillsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [sharedBills, setSharedBills] = useState<SharedBill[]>([]);
  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedShare, setSelectedShare] = useState<SharedBill | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  const styles = createStyles(colors, insets);

  const fetchData = useCallback(async () => {
    try {
      const [sharedRes, pendingRes] = await Promise.all([
        api.getSharedBills(),
        api.getPendingShares(),
      ]);

      if (sharedRes.success && sharedRes.data) {
        setSharedBills(sharedRes.data);
      }
      if (pendingRes.success && pendingRes.data) {
        setPendingShares(pendingRes.data);
      }
      setError(null);
    } catch (err) {
      setError('Failed to load shared bills');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchData();
  }, [fetchData]);

  const handleAcceptShare = async (shareId: number) => {
    const result = await api.acceptShare(shareId);
    if (result.success) {
      fetchData();
    } else {
      Alert.alert('Error', result.error || 'Failed to accept share');
    }
  };

  const handleDeclineShare = async (shareId: number) => {
    Alert.alert(
      'Decline Invitation',
      'Are you sure you want to decline this bill share invitation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            const result = await api.declineShare(shareId);
            if (result.success) {
              fetchData();
            } else {
              Alert.alert('Error', result.error || 'Failed to decline share');
            }
          },
        },
      ]
    );
  };

  const handleLeaveShare = async () => {
    if (!selectedShare) return;

    setIsLeaving(true);
    const result = await api.leaveShare(selectedShare.share_id);
    setIsLeaving(false);

    if (result.success) {
      setSelectedShare(null);
      fetchData();
    } else {
      Alert.alert('Error', result.error || 'Failed to leave share');
    }
  };

  const renderPendingItem = ({ item }: { item: PendingShare }) => (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHeader}>
        <BillIcon
          icon={item.bill_icon}
          size={20}
          containerSize={40}
          color={colors.warning}
          backgroundColor={colors.warning + '15'}
        />
        <View style={styles.pendingInfo}>
          <Text style={styles.pendingBillName}>{item.bill_name}</Text>
          <Text style={styles.pendingOwner}>from {item.owner}</Text>
        </View>
        {item.bill_amount && (
          <Text style={styles.pendingAmount}>{formatCurrency(item.bill_amount)}</Text>
        )}
      </View>
      {item.split_type && (
        <Text style={styles.splitInfo}>
          Your portion: {getSplitLabel(item.split_type, item.split_value)}
        </Text>
      )}
      <View style={styles.pendingActions}>
        <TouchableOpacity
          style={styles.declineButton}
          onPress={() => handleDeclineShare(item.share_id)}
        >
          <Text style={styles.declineButtonText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={() => handleAcceptShare(item.share_id)}
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSharedBillItem = ({ item }: { item: SharedBill }) => {
    const daysUntil = getDaysUntil(item.bill.next_due);
    const isOverdue = daysUntil < 0;
    const isDeposit = item.bill.type === 'deposit';

    const dueText = isOverdue
      ? `Due ${Math.abs(daysUntil)}d ago`
      : daysUntil === 0
      ? 'Due Today'
      : `Due in ${daysUntil}d`;

    return (
      <TouchableOpacity
        style={styles.sharedCard}
        onPress={() => setSelectedShare(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          <BillIcon
            icon={item.bill.icon}
            size={24}
            containerSize={48}
            color={isDeposit ? colors.success : colors.primary}
            backgroundColor={isDeposit ? colors.success + '15' : colors.primary + '15'}
          />

          <View style={styles.cardMiddle}>
            <Text style={styles.billName} numberOfLines={1}>{item.bill.name}</Text>
            <Text style={styles.ownerText}>Shared by {item.owner}</Text>
            <Text style={styles.dueText}>{formatDate(item.bill.next_due)} - {dueText}</Text>
          </View>

          <View style={styles.cardRight}>
            <Text style={[styles.billAmount, { color: isDeposit ? colors.success : colors.text }]}>
              {formatCurrency(item.bill.amount)}
            </Text>
            {item.split_type && item.my_portion && (
              <Text style={styles.portionText}>
                You: {formatCurrency(item.my_portion)}
              </Text>
            )}
          </View>
        </View>

        {item.last_payment && (
          <View style={styles.lastPaymentBadge}>
            <Text style={styles.lastPaymentText}>
              Last paid: {formatDate(item.last_payment.date)} ({formatCurrency(item.last_payment.amount)})
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasContent = sharedBills.length > 0 || pendingShares.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Shared Bills</Text>
        <Text style={styles.headerSubtitle}>
          {sharedBills.length} active • {pendingShares.length} pending
        </Text>
      </View>

      {!hasContent ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No shared bills yet</Text>
          <Text style={styles.emptySubtext}>
            When someone shares a bill with you, it will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={[...pendingShares.map(p => ({ type: 'pending' as const, data: p })),
                 ...sharedBills.map(s => ({ type: 'shared' as const, data: s }))]}
          keyExtractor={(item) =>
            item.type === 'pending'
              ? `pending-${item.data.share_id}`
              : `shared-${item.data.share_id}`
          }
          renderItem={({ item, index }) => {
            // Show section header before first shared bill
            const showActiveSectionHeader =
              item.type === 'shared' &&
              index === pendingShares.length &&
              sharedBills.length > 0;

            return (
              <>
                {showActiveSectionHeader && (
                  <Text style={[styles.sectionTitle, styles.activeSectionTitle]}>
                    Active Shared Bills
                  </Text>
                )}
                {item.type === 'pending'
                  ? renderPendingItem({ item: item.data as PendingShare })
                  : renderSharedBillItem({ item: item.data as SharedBill })}
              </>
            );
          }}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={
            pendingShares.length > 0 ? (
              <Text style={styles.sectionTitle}>Pending Invitations</Text>
            ) : null
          }
          stickyHeaderIndices={pendingShares.length > 0 ? [0] : undefined}
        />
      )}

      {/* Bill Detail Modal */}
      <Modal
        visible={selectedShare !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSelectedShare(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedShare && (
              <>
                <Text style={styles.modalTitle}>{selectedShare.bill.name}</Text>
                <Text style={styles.modalSubtitle}>Shared by {selectedShare.owner}</Text>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalLabel}>Amount</Text>
                  <Text style={styles.modalValue}>{formatCurrency(selectedShare.bill.amount)}</Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalLabel}>Next Due</Text>
                  <Text style={styles.modalValue}>{formatDate(selectedShare.bill.next_due)}</Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalLabel}>Frequency</Text>
                  <Text style={styles.modalValue}>{selectedShare.bill.frequency}</Text>
                </View>

                {selectedShare.split_type && (
                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalLabel}>Your Portion</Text>
                    <Text style={styles.modalValue}>
                      {getSplitLabel(selectedShare.split_type, selectedShare.split_value)}
                      {selectedShare.my_portion && ` (${formatCurrency(selectedShare.my_portion)})`}
                    </Text>
                  </View>
                )}

                {selectedShare.last_payment && (
                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalLabel}>Last Payment</Text>
                    <Text style={styles.modalValue}>
                      {formatDate(selectedShare.last_payment.date)} - {formatCurrency(selectedShare.last_payment.amount)}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.leaveButton}
                  onPress={() => {
                    Alert.alert(
                      'Leave Shared Bill',
                      'Are you sure you want to stop watching this shared bill?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Leave',
                          style: 'destructive',
                          onPress: handleLeaveShare,
                        },
                      ]
                    );
                  }}
                  disabled={isLeaving}
                >
                  {isLeaving ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <Text style={styles.leaveButtonText}>Leave Shared Bill</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.modalButtons}>
                  <Pressable
                    style={[styles.modalButton, styles.modalCloseButton]}
                    onPress={() => setSelectedShare(null)}
                  >
                    <Text style={styles.modalCloseText}>Close</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: any, insets: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: insets.top + 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.warning,
    marginBottom: 12,
    backgroundColor: colors.background,
    paddingVertical: 8,
  },
  activeSectionTitle: {
    color: colors.primary,
    marginTop: 16,
  },
  pendingCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.warning + '40',
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pendingInfo: {
    flex: 1,
    marginLeft: 12,
  },
  pendingBillName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  pendingOwner: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  pendingAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  splitInfo: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  pendingActions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  declineButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  declineButtonText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  acceptButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  sharedCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMiddle: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  billName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  ownerText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  dueText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  billAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  portionText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 2,
  },
  lastPaymentBadge: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastPaymentText: {
    fontSize: 12,
    color: colors.success,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 17,
    color: colors.textMuted,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  modalValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  leaveButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  modalButtons: {
    marginTop: 16,
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCloseButton: {
    backgroundColor: colors.primary,
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
