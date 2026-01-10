import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search, X, ChevronDown } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { Bill } from '../types';
import { BillIcon } from '../components/BillIcon';

type BillsStackParamList = {
  BillsList: undefined;
  BillDetail: { billId: number };
  AddBill: undefined;
};

type NavigationProp = NativeStackNavigationProp<BillsStackParamList, 'BillsList'>;
type FilterType = 'all' | 'expense' | 'deposit';

const formatCurrency = (amount: number | null, avgAmount?: number): string => {
  if (amount === null) {
    if (avgAmount && avgAmount > 0) {
      return `~$${avgAmount.toFixed(2)}`;
    }
    return 'Variable';
  }
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

const getDueBadgeColor = (daysUntil: number): string => {
  if (daysUntil < 0) return '#ef4444';
  if (daysUntil <= 7) return '#ef4444';
  if (daysUntil <= 14) return '#f97316';
  if (daysUntil <= 21) return '#eab308';
  if (daysUntil <= 30) return '#3b82f6';
  return '#6b7280';
};

export default function BillsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { currentDatabase, databases, selectDatabase } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [showDbPicker, setShowDbPicker] = useState(false);

  const styles = createStyles(colors, insets);

  const fetchBills = useCallback(async () => {
    if (!currentDatabase) return;

    try {
      const response = await api.getBills();
      if (response.success && response.data) {
        const sorted = [...response.data].sort((a, b) => {
          return new Date(a.next_due).getTime() - new Date(b.next_due).getTime();
        });
        setBills(sorted);
        setError(null);
      } else {
        setError(response.error || 'Failed to load bills');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentDatabase]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  useFocusEffect(
    useCallback(() => {
      fetchBills();
    }, [fetchBills])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchBills();
  }, [fetchBills]);

  const handleBillPress = (bill: Bill) => {
    navigation.navigate('BillDetail', { billId: bill.id });
  };

  const handleAddBill = () => {
    navigation.navigate('AddBill');
  };

  const handleSelectDatabase = async (dbName: string) => {
    setShowDbPicker(false);
    if (dbName !== currentDatabase) {
      setIsLoading(true);
      await selectDatabase(dbName);
    }
  };

  const currentDbInfo = databases.find(db => db.name === currentDatabase);

  const filteredBills = useMemo(() => {
    let result = bills;

    if (filter !== 'all') {
      result = result.filter(bill => bill.type === filter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(bill =>
        bill.name.toLowerCase().includes(query) ||
        (bill.account && bill.account.toLowerCase().includes(query)) ||
        (bill.notes && bill.notes.toLowerCase().includes(query))
      );
    }

    return result;
  }, [bills, filter, searchQuery]);

  const counts = {
    all: bills.length,
    expense: bills.filter(b => b.type === 'expense').length,
    deposit: bills.filter(b => b.type === 'deposit').length,
  };

  const renderBillCard = ({ item: bill }: { item: Bill }) => {
    const daysUntil = getDaysUntil(bill.next_due);
    const isOverdue = daysUntil < 0;
    const isDeposit = bill.type === 'deposit';
    const isShared = bill.is_shared;
    const badgeColor = getDueBadgeColor(daysUntil);

    const dueText = isOverdue
      ? `Due ${Math.abs(daysUntil)}d ago`
      : daysUntil === 0
      ? 'Due Today'
      : `Due in ${daysUntil}d`;

    return (
      <TouchableOpacity
        style={[
          styles.billCard,
          isShared && { backgroundColor: colors.primary + '08', borderLeftWidth: 3, borderLeftColor: colors.primary }
        ]}
        onPress={() => handleBillPress(bill)}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          <BillIcon
            icon={bill.icon}
            size={24}
            containerSize={48}
            color={isDeposit ? colors.success : colors.primary}
            backgroundColor={isDeposit ? colors.success + '15' : colors.primary + '15'}
          />

          <View style={styles.cardMiddle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.billName} numberOfLines={1}>{bill.name}</Text>
              {isShared && (
                <View style={[styles.sharedBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.sharedBadgeText}>Shared</Text>
                </View>
              )}
            </View>
            {isShared && bill.share_info && (
              <Text style={styles.sharedOwner} numberOfLines={1}>
                Shared by {bill.share_info.owner_name}
              </Text>
            )}
            <View style={styles.dueRow}>
              <View style={[styles.dueDot, { backgroundColor: badgeColor }]} />
              <Text style={[styles.dueText, { color: badgeColor }]}>
                {formatDate(bill.next_due)} • {dueText}
              </Text>
            </View>
          </View>

          <View style={styles.cardRight}>
            <Text style={[styles.billAmount, { color: isDeposit ? colors.success : colors.text }]}>
              {isDeposit ? '+' : ''}{formatCurrency(bill.amount, bill.avg_amount)}
            </Text>
            {isShared && bill.share_info?.my_portion !== null && bill.share_info?.my_portion !== undefined && (
              <Text style={styles.myPortion}>
                My portion: ${bill.share_info.my_portion.toFixed(2)}
              </Text>
            )}
            {bill.account && !isShared && (
              <Text style={styles.billAccount} numberOfLines={1}>{bill.account}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFilterTabs = () => {
    const tabs: { key: FilterType; label: string }[] = [
      { key: 'all', label: `All (${counts.all})` },
      { key: 'expense', label: 'Expenses' },
      { key: 'deposit', label: 'Income' },
    ];

    return (
      <View style={styles.filterContainer}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.filterButton,
              filter === tab.key ? styles.filterButtonActive : styles.filterButtonInactive,
            ]}
            onPress={() => setFilter(tab.key)}
          >
            <Text
              style={[
                styles.filterButtonText,
                filter === tab.key ? styles.filterButtonTextActive : styles.filterButtonTextInactive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
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
        <TouchableOpacity style={styles.retryButton} onPress={fetchBills}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => databases.length > 1 && setShowDbPicker(true)}
            style={styles.dbSelector}
            activeOpacity={databases.length > 1 ? 0.7 : 1}
          >
            <Text style={styles.headerTitle}>
              {currentDbInfo?.display_name || 'Bills'}
            </Text>
            {databases.length > 1 && (
              <ChevronDown size={16} color={colors.textMuted} style={styles.dropdownArrow} />
            )}
          </TouchableOpacity>
          
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleAddBill}
              style={styles.iconButton}
            >
              <Plus size={24} color={colors.primary} />
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => setShowSearch(!showSearch)}
              style={[styles.iconButton, showSearch && styles.iconButtonActive]}
            >
              <Search size={22} color={showSearch ? '#fff' : colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.headerSubtitle}>
          {counts.expense} expense{counts.expense !== 1 ? 's' : ''} •{' '}
          {counts.deposit} deposit{counts.deposit !== 1 ? 's' : ''}
        </Text>

        {showSearch && (
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search bills..."
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearSearchButton}
              >
                <X size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {(filter !== 'all' || searchQuery.length > 0) && (
          <View style={styles.activeFilterBanner}>
            <Text style={styles.activeFilterText}>
              Showing {filter !== 'all' ? (filter === 'expense' ? 'expenses' : 'income') : 'all'}
              {searchQuery.length > 0 ? ` matching "${searchQuery}"` : ''}
              {' '}({filteredBills.length} result{filteredBills.length !== 1 ? 's' : ''})
            </Text>
            <TouchableOpacity
              style={styles.clearAllButton}
              onPress={() => {
                setFilter('all');
                setSearchQuery('');
                setShowSearch(false);
              }}
            >
              <Text style={styles.clearAllButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}

        {renderFilterTabs()}
      </View>

      <FlatList
        data={filteredBills}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderBillCard}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchQuery || filter !== 'all' ? 'No matching bills' : 'No bills yet'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery || filter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Add your first bill to get started'}
            </Text>
          </View>
        }
      />

      <Modal
        visible={showDbPicker}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowDbPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDbPicker(false)}
        >
          <View style={styles.dbPickerContainer}>
            <Text style={styles.dbPickerTitle}>Select Bill Group</Text>
            {databases.map((db) => (
              <TouchableOpacity
                key={db.id}
                style={[
                  styles.dbPickerItem,
                  db.name === currentDatabase && styles.dbPickerItemActive,
                ]}
                onPress={() => handleSelectDatabase(db.name)}
              >
                <Text
                  style={[
                    styles.dbPickerItemText,
                    db.name === currentDatabase && styles.dbPickerItemTextActive,
                  ]}
                >
                  {db.display_name}
                </Text>
                {db.name === currentDatabase && (
                  <Text style={styles.dbPickerCheck}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
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
    paddingBottom: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconButtonActive: {
    backgroundColor: colors.primary,
  },
  searchContainer: {
    marginTop: 12,
    position: 'relative',
  },
  searchInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  clearSearchButton: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilterBanner: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeFilterText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
    flex: 1,
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.primary,
    borderRadius: 6,
  },
  clearAllButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  filterContainer: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterButtonInactive: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  filterButtonTextInactive: {
    color: colors.textMuted,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  billCard: {
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
    justifyContent: 'center',
  },
  billName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dueDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  dueText: {
    fontSize: 12,
    fontWeight: '500',
  },
  cardRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  billAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  billAccount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  sharedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sharedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  sharedOwner: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  myPortion: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 17,
    color: colors.textMuted,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
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
  dbSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dropdownArrow: {
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dbPickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 320,
  },
  dbPickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  dbPickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: colors.background,
  },
  dbPickerItemActive: {
    backgroundColor: colors.primary + '20',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dbPickerItemText: {
    fontSize: 16,
    color: colors.text,
  },
  dbPickerItemTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  dbPickerCheck: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600',
  },
});