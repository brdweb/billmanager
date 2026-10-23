import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Switch,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { formatDate } from '../i18n/format';
import { Invitation, DatabaseInfo } from '../types';

type Props = NativeStackScreenProps<any, 'Invitations'>;

export default function InvitationsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { databases } = useAuth();
  const { emailEnabled } = useConfig();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New invitation modal state
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [selectedDatabases, setSelectedDatabases] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchInvitations = useCallback(async () => {
    try {
      const response = await api.getInvitations();
      if (response.success && response.data) {
        setInvitations(response.data);
        setError(null);
      } else {
        setError(response.error || t('mobileParity.invitations.loadFailed'));
      }
    } catch (err) {
      setError(t('mobileParity.common.networkError'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  useFocusEffect(
    useCallback(() => {
      fetchInvitations();
    }, [fetchInvitations])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchInvitations();
  }, [fetchInvitations]);

  const handleCreateInvitation = async () => {
    if (!email.trim()) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.invitations.emailRequired'));
      return;
    }

    if (selectedDatabases.length === 0) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.invitations.chooseGroup'));
      return;
    }

    setIsSubmitting(true);
    const result = await api.createInvitation(email.trim(), role, selectedDatabases);
    setIsSubmitting(false);

    if (result.success) {
      setShowModal(false);
      setEmail('');
      setRole('user');
      setSelectedDatabases([]);
      fetchInvitations();
      Alert.alert(t('mobileParity.common.success'), t('mobileParity.invitations.sent'));
    } else {
      Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.invitations.sendFailed'));
    }
  };

  const handleResendInvitation = (invitation: Invitation) => {
    Alert.alert(
      t('mobileParity.invitations.resendTitle'),
      t('mobileParity.invitations.resendBody', { email: invitation.email }),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileParity.invitations.resend'),
          onPress: async () => {
            const result = await api.resendInvitation(invitation.id);
            if (result.success) {
              Alert.alert(t('mobileParity.common.success'), t('mobileParity.invitations.resent'));
            } else {
              Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.invitations.resendFailed'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteInvitation = (invitation: Invitation) => {
    Alert.alert(
      t('mobileParity.invitations.cancelTitle'),
      t('mobileParity.invitations.cancelBody', { email: invitation.email }),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileParity.invitations.cancelAction'),
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteInvitation(invitation.id);
            if (result.success) {
              fetchInvitations();
            } else {
              Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.invitations.cancelFailed'));
            }
          },
        },
      ]
    );
  };

  const toggleDatabase = (dbId: number) => {
    setSelectedDatabases(prev =>
      prev.includes(dbId)
        ? prev.filter(id => id !== dbId)
        : [...prev, dbId]
    );
  };

  const isExpired = (expiresAt: string): boolean => {
    return new Date(expiresAt) < new Date();
  };

  const renderInvitation = ({ item }: { item: Invitation }) => {
    const expired = isExpired(item.expires_at);

    return (
      <View style={[styles.inviteCard, { backgroundColor: colors.surface }]}>
        <View style={styles.inviteInfo}>
          <View style={styles.inviteHeader}>
            <Text style={[styles.email, { color: colors.text }]}>{item.email}</Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: expired ? colors.danger : colors.success }
            ]}>
              <Text style={styles.statusText}>
                {expired ? t('mobileParity.invitations.expired') : t('mobileParity.invitations.pending')}
              </Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {t('mobileParity.invitations.metadata', {
              role: item.role === 'admin' ? t('mobileParity.common.admin') : t('mobileParity.common.user'),
              date: formatDate(item.created_at, { month: 'short', day: 'numeric', year: 'numeric' }),
            })}
          </Text>
          <Text style={[styles.meta, { color: expired ? colors.danger : colors.textMuted }]}>
            {t(expired ? 'mobileParity.invitations.expiredOn' : 'mobileParity.invitations.expiresOn', {
              date: formatDate(item.expires_at, { month: 'short', day: 'numeric', year: 'numeric' }),
            })}
          </Text>
        </View>

        <View style={styles.actions}>
          {!expired && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleResendInvitation(item)}
            >
              <Text style={styles.actionButtonTextWhite}>{t('mobileParity.invitations.resend')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.border }]}
            onPress={() => handleDeleteInvitation(item)}
          >
            <Text style={[styles.actionButtonText, { color: colors.text }]}>{t('mobileParity.common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backButtonText, { color: colors.primary }]}>← {t('mobileParity.common.back')}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('mobileParity.invitations.title')}</Text>
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addButton}>
          <Text style={[styles.addButtonText, { color: colors.primary }]}>+ {t('mobileParity.invitations.invite')}</Text>
        </TouchableOpacity>
      </View>

      {/* Email disabled warning banner */}
      {!emailEnabled && (
        <View style={[styles.warningBanner, { backgroundColor: colors.warning + '20' }]}>
          <Text style={[styles.warningText, { color: colors.warning }]}>
            {t('mobileParity.invitations.emailWarning')}
          </Text>
        </View>
      )}

      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={fetchInvitations}
          >
            <Text style={styles.retryButtonText}>{t('mobileParity.common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={invitations}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderInvitation}
          contentContainerStyle={styles.list}
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
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('mobileParity.invitations.noPending')}</Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                {t('mobileParity.invitations.emptyBody')}
              </Text>
            </View>
          }
          ListHeaderComponent={
            invitations.length > 0 ? (
              <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
                {t('mobileParity.invitations.count', { count: invitations.length })}
              </Text>
            ) : undefined
          }
        />
      )}

      {/* New Invitation Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('mobileParity.invitations.inviteUser')}</Text>

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.invitations.emailAddress')}</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={email}
              onChangeText={setEmail}
              placeholder={t('admin.users.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.role')}</Text>
            <View style={styles.roleToggle}>
              <TouchableOpacity
                style={[
                  styles.roleButton,
                  { backgroundColor: colors.background, borderColor: colors.border },
                  role === 'user' && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setRole('user')}
              >
                <Text style={[
                  styles.roleButtonText,
                  { color: colors.text },
                  role === 'user' && { color: '#fff' },
                ]}>
                  {t('mobileParity.common.user')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleButton,
                  { backgroundColor: colors.background, borderColor: colors.border },
                  role === 'admin' && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => setRole('admin')}
              >
                <Text style={[
                  styles.roleButtonText,
                  { color: colors.text },
                  role === 'admin' && { color: '#fff' },
                ]}>
                  {t('mobileParity.common.admin')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.invitations.billGroups')}</Text>
            <View style={styles.databaseList}>
              {databases.map((db) => (
                <TouchableOpacity
                  key={db.id}
                  style={[
                    styles.databaseItem,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    selectedDatabases.includes(db.id) && { borderColor: colors.primary },
                  ]}
                  onPress={() => toggleDatabase(db.id)}
                >
                  <Text style={[styles.databaseName, { color: colors.text }]}>
                    {db.display_name}
                  </Text>
                  <View style={[
                    styles.checkbox,
                    { borderColor: colors.border },
                    selectedDatabases.includes(db.id) && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}>
                    {selectedDatabases.includes(db.id) && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setShowModal(false)}
                disabled={isSubmitting}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>{t('mobileParity.common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.primary }, isSubmitting && styles.buttonDisabled]}
                onPress={handleCreateInvitation}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>{t('mobileParity.invitations.sendInvite')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  addButton: {
    padding: 4,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  warningBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    marginBottom: 12,
  },
  inviteCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  inviteInfo: {
    marginBottom: 12,
  },
  inviteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  meta: {
    fontSize: 13,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  actionButtonTextWhite: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  roleToggle: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
  },
  roleButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  databaseList: {
    marginBottom: 24,
  },
  databaseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  databaseName: {
    fontSize: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
