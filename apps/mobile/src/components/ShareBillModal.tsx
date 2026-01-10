import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  FlatList,
  Alert,
  Pressable,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { Bill, BillShare, UserSearchResult } from '../types';

interface ShareBillModalProps {
  visible: boolean;
  onClose: () => void;
  bill: Bill;
  onShareCreated?: () => void;
}

type SplitType = 'none' | 'percentage' | 'fixed' | 'equal';

export default function ShareBillModal({ visible, onClose, bill, onShareCreated }: ShareBillModalProps) {
  const { colors } = useTheme();
  const [identifier, setIdentifier] = useState('');
  const [splitType, setSplitType] = useState<SplitType>('none');
  const [splitValue, setSplitValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [existingShares, setExistingShares] = useState<BillShare[]>([]);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaas, setIsSaas] = useState(false);

  const styles = createStyles(colors);

  useEffect(() => {
    if (visible) {
      fetchExistingShares();
      checkDeploymentMode();
    }
  }, [visible, bill.id]);

  const fetchExistingShares = async () => {
    const result = await api.getBillShares(bill.id);
    if (result.success && result.data) {
      setExistingShares(result.data);
    }
  };

  const checkDeploymentMode = async () => {
    const config = await api.getAppConfig();
    if (config.success && config.data) {
      setIsSaas(config.data.deployment_mode === 'saas');
    }
  };

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const result = await api.searchUsers(query);
    if (result.success && result.data) {
      setSearchResults(result.data);
    }
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Only search for usernames (non-email) in self-hosted mode
      if (!isSaas && identifier && !identifier.includes('@')) {
        searchUsers(identifier);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [identifier, isSaas, searchUsers]);

  const handleShare = async () => {
    if (!identifier.trim()) {
      Alert.alert('Error', isSaas ? 'Please enter an email or username' : 'Please enter a username');
      return;
    }

    if (splitType === 'percentage') {
      const pct = parseFloat(splitValue);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        Alert.alert('Error', 'Please enter a valid percentage (1-100)');
        return;
      }
    }

    if (splitType === 'fixed') {
      const fixed = parseFloat(splitValue);
      if (isNaN(fixed) || fixed <= 0) {
        Alert.alert('Error', 'Please enter a valid fixed amount');
        return;
      }
    }

    setIsLoading(true);
    const result = await api.shareBill(bill.id, {
      identifier: identifier.trim(),
      split_type: splitType === 'none' ? null : splitType,
      split_value: splitType === 'percentage' || splitType === 'fixed' ? parseFloat(splitValue) : null,
    });
    setIsLoading(false);

    if (result.success) {
      Alert.alert('Success', result.data?.message || 'Bill shared successfully');
      setIdentifier('');
      setSplitType('none');
      setSplitValue('');
      fetchExistingShares();
      onShareCreated?.();
    } else {
      Alert.alert('Error', result.error || 'Failed to share bill');
    }
  };

  const handleRevokeShare = async (shareId: number) => {
    Alert.alert(
      'Revoke Share',
      'Are you sure you want to stop sharing this bill with this user?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            const result = await api.revokeShare(shareId);
            if (result.success) {
              fetchExistingShares();
            } else {
              Alert.alert('Error', result.error || 'Failed to revoke share');
            }
          },
        },
      ]
    );
  };

  const handleSelectUser = (user: UserSearchResult) => {
    setIdentifier(user.username);
    setSearchResults([]);
  };

  const handleClose = () => {
    setIdentifier('');
    setSplitType('none');
    setSplitValue('');
    setSearchResults([]);
    onClose();
  };

  const getSplitLabel = (type: string | null, value: number | null): string => {
    if (!type) return 'Full amount';
    switch (type) {
      case 'percentage':
        return `${value}%`;
      case 'fixed':
        return `$${value?.toFixed(2)}`;
      case 'equal':
        return '50/50';
      default:
        return 'Full amount';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'accepted':
        return colors.success;
      case 'pending':
        return colors.warning;
      case 'declined':
      case 'revoked':
        return colors.danger;
      default:
        return colors.textMuted;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Share Bill</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.content}>
          <Text style={styles.billName}>{bill.name}</Text>

          <View style={styles.section}>
            <Text style={styles.label}>
              {isSaas ? 'Username or Email' : 'Username'}
            </Text>
            <TextInput
              style={styles.input}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={isSaas ? 'Enter username or email' : 'Enter username'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={isSaas ? 'email-address' : 'default'}
            />

            {/* Username search results */}
            {searchResults.length > 0 && (
              <View style={styles.searchResults}>
                {searchResults.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    style={styles.searchResultItem}
                    onPress={() => handleSelectUser(user)}
                  >
                    <Text style={styles.searchResultText}>{user.username}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {isSearching && (
              <View style={styles.searchingIndicator}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Split Configuration (Optional)</Text>
            <View style={styles.splitOptions}>
              {(['none', 'equal', 'percentage', 'fixed'] as SplitType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.splitOption,
                    splitType === type && styles.splitOptionActive,
                  ]}
                  onPress={() => setSplitType(type)}
                >
                  <Text
                    style={[
                      styles.splitOptionText,
                      splitType === type && styles.splitOptionTextActive,
                    ]}
                  >
                    {type === 'none' ? 'None' : type === 'equal' ? '50/50' : type === 'percentage' ? '%' : '$'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {(splitType === 'percentage' || splitType === 'fixed') && (
              <TextInput
                style={[styles.input, { marginTop: 12 }]}
                value={splitValue}
                onChangeText={setSplitValue}
                placeholder={splitType === 'percentage' ? 'Enter percentage (e.g., 50)' : 'Enter amount'}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            )}
          </View>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.shareButtonText}>Share Bill</Text>
            )}
          </TouchableOpacity>

          {existingShares.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Currently Shared With</Text>
              {existingShares.map((share) => (
                <View key={share.id} style={styles.shareItem}>
                  <View style={styles.shareItemInfo}>
                    <Text style={styles.shareItemUser}>{share.shared_with}</Text>
                    <View style={styles.shareItemMeta}>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(share.status) + '20' }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(share.status) }]}>
                          {share.status}
                        </Text>
                      </View>
                      <Text style={styles.shareItemSplit}>
                        {getSplitLabel(share.split_type, share.split_value)}
                      </Text>
                    </View>
                  </View>
                  {share.status !== 'revoked' && (
                    <TouchableOpacity
                      style={styles.revokeButton}
                      onPress={() => handleRevokeShare(share.id)}
                    >
                      <Text style={styles.revokeButtonText}>Revoke</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 16,
    color: colors.primary,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  billName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 24,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  searchResults: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  searchResultItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultText: {
    fontSize: 15,
    color: colors.text,
  },
  searchingIndicator: {
    position: 'absolute',
    right: 12,
    top: 40,
  },
  splitOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  splitOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  splitOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  splitOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  splitOptionTextActive: {
    color: colors.primary,
  },
  shareButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  shareItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  shareItemInfo: {
    flex: 1,
  },
  shareItemUser: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  shareItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  shareItemSplit: {
    fontSize: 12,
    color: colors.textMuted,
  },
  revokeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  revokeButtonText: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: '500',
  },
});
