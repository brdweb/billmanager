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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { formatDate } from '../i18n/format';
import { AdminUser } from '../types';

type Props = NativeStackScreenProps<any, 'UserManagement'>;

export default function UserManagementScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user, databases } = useAuth();
  const { isSelfHosted } = useConfig();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create user modal state (for self-hosted mode)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [selectedDatabases, setSelectedDatabases] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await api.getUsers();
      if (response.success && response.data) {
        setUsers(response.data);
        setError(null);
      } else {
        setError(response.error || t('mobileParity.userManagement.loadFailed'));
      }
    } catch (err) {
      if (__DEV__) {
        console.log('[UserManagementScreen] Error:', err);
      }
      setError(t('mobileParity.common.networkError'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useFocusEffect(
    useCallback(() => {
      fetchUsers();
    }, [fetchUsers])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleRole = (targetUser: AdminUser) => {
    if (targetUser.id === user?.id) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.cannotChangeOwnRole'));
      return;
    }

    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    Alert.alert(
      t('mobileParity.userManagement.changeRoleTitle'),
      t('mobileParity.userManagement.changeRoleBody', {
        name: targetUser.username,
        current: targetUser.role === 'admin' ? t('mobileParity.common.admin') : t('mobileParity.common.user'),
        next: newRole === 'admin' ? t('mobileParity.common.admin') : t('mobileParity.common.user'),
      }),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileParity.common.confirm'),
          onPress: async () => {
            const result = await api.updateUserRole(targetUser.id, newRole);
            if (result.success) {
              fetchUsers();
            } else {
              Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.userManagement.updateRoleFailed'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteUser = (targetUser: AdminUser) => {
    if (targetUser.id === user?.id) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.cannotDeleteOwn'));
      return;
    }

    Alert.alert(
      t('mobileParity.userManagement.deleteTitle'),
      t('mobileParity.userManagement.deleteBody', { name: targetUser.username }),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileParity.common.delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteUser(targetUser.id);
            if (result.success) {
              fetchUsers();
              Alert.alert(t('mobileParity.common.success'), t('mobileParity.userManagement.deleted'));
            } else {
              Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.userManagement.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  const openEditModal = (targetUser: AdminUser) => {
    setEditingUser(targetUser);
    setEditEmail(targetUser.email || '');
    setEditRole(targetUser.role);
    setShowEditModal(true);
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSubmitting(true);
    const result = await api.updateUser(editingUser.id, {
      email: editEmail.trim() || undefined,
      role: editRole,
    });
    setIsSubmitting(false);

    if (result.success) {
      setShowEditModal(false);
      fetchUsers();
      Alert.alert(t('mobileParity.common.success'), t('mobileParity.userManagement.updated'));
    } else {
      Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.userManagement.updateFailed'));
    }
  };

  const openCreateModal = () => {
    setNewUsername('');
    setNewEmail('');
    setNewPassword('');
    setNewRole('user');
    setSelectedDatabases([]);
    setShowCreateModal(true);
  };

  const toggleDatabaseSelection = (dbId: number) => {
    setSelectedDatabases(prev =>
      prev.includes(dbId)
        ? prev.filter(id => id !== dbId)
        : [...prev, dbId]
    );
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim()) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.usernameRequired'));
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.passwordRequired'));
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.passwordLength'));
      return;
    }
    if (selectedDatabases.length === 0) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.userManagement.chooseGroup'));
      return;
    }

    setIsCreating(true);
    const result = await api.createUser({
      username: newUsername.trim(),
      password: newPassword,
      email: newEmail.trim() || undefined,
      role: newRole,
      database_ids: selectedDatabases,
    });
    setIsCreating(false);

    if (result.success) {
      setShowCreateModal(false);
      fetchUsers();
      Alert.alert(t('mobileParity.common.success'), t('mobileParity.userManagement.created'));
    } else {
      Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.userManagement.createFailed'));
    }
  };

  const renderUser = ({ item }: { item: AdminUser }) => {
    const isCurrentUser = item.id === user?.id;

    return (
      <View style={[styles.userCard, { backgroundColor: colors.surface }]}>
        <View style={styles.userInfo}>
          <View style={styles.userHeader}>
            <Text style={[styles.username, { color: colors.text }]}>
              {item.username}
              {isCurrentUser && <Text style={{ color: colors.textMuted }}> ({t('mobileParity.userManagement.you')})</Text>}
            </Text>
            <View style={[
              styles.roleBadge,
              { backgroundColor: item.role === 'admin' ? colors.primary : colors.border }
            ]}>
              <Text style={[
                styles.roleText,
                { color: item.role === 'admin' ? '#fff' : colors.text }
              ]}>
                {item.role === 'admin' ? t('mobileParity.common.admin') : t('mobileParity.common.user')}
              </Text>
            </View>
          </View>
          {item.email && (
            <Text style={[styles.email, { color: colors.textMuted }]}>{item.email}</Text>
          )}
          <Text style={[styles.date, { color: colors.textMuted }]}>
            {t('mobileParity.userManagement.joined', {
              date: item.created_at
                ? formatDate(item.created_at, { month: 'short', day: 'numeric', year: 'numeric' })
                : t('mobileParity.common.unknown'),
            })}
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={() => openEditModal(item)}
          >
            <Text style={styles.editButtonText}>{t('mobileParity.common.edit')}</Text>
          </TouchableOpacity>
          {!isCurrentUser && (
            <>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.border }]}
                onPress={() => handleToggleRole(item)}
              >
                <Text style={[styles.actionButtonText, { color: colors.text }]}>
                  {item.role === 'admin'
                    ? t('mobileParity.userManagement.demote')
                    : t('mobileParity.userManagement.promote')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.danger }]}
                onPress={() => handleDeleteUser(item)}
              >
                <Text style={styles.deleteButtonText}>{t('mobileParity.common.delete')}</Text>
              </TouchableOpacity>
            </>
          )}
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('mobileParity.userManagement.title')}</Text>
        {/* Add User button - only for self-hosted mode */}
        {isSelfHosted ? (
          <TouchableOpacity onPress={openCreateModal} style={styles.addButton}>
            <Text style={[styles.addButtonText, { color: colors.primary }]}>+ {t('mobileParity.common.add')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={fetchUsers}
          >
            <Text style={styles.retryButtonText}>{t('mobileParity.common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderUser}
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
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('mobileParity.userManagement.noUsers')}</Text>
            </View>
          }
          ListHeaderComponent={
            <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
              {t('mobileParity.userManagement.count', { count: users.length })}
            </Text>
          }
        />
      )}

      {/* Edit User Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('mobileParity.userManagement.editUser')}
            </Text>
            {editingUser && (
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                {editingUser.username}
              </Text>
            )}

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.email')}</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={editEmail}
              editable={false}
              onChangeText={setEditEmail}
              placeholder={t('admin.users.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.role')}</Text>
            <View style={styles.roleSelector}>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  { backgroundColor: editRole === 'user' ? colors.primary : colors.border }
                ]}
                onPress={() => setEditRole('user')}
              >
                <Text style={[
                  styles.roleOptionText,
                  { color: editRole === 'user' ? '#fff' : colors.text }
                ]}>
                  {t('mobileParity.common.user')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  { backgroundColor: editRole === 'admin' ? colors.primary : colors.border }
                ]}
                onPress={() => setEditRole('admin')}
              >
                <Text style={[
                  styles.roleOptionText,
                  { color: editRole === 'admin' ? '#fff' : colors.text }
                ]}>
                  {t('mobileParity.common.admin')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setShowEditModal(false)}
                disabled={isSubmitting}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>{t('mobileParity.common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }, isSubmitting && styles.buttonDisabled]}
                onPress={handleSaveUser}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('mobileParity.common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create User Modal (for self-hosted mode) */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('mobileParity.userManagement.createUser')}</Text>

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.usernameLabel')}</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder={t('mobileParity.userManagement.usernamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.emailOptional')}</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder={t('admin.users.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.passwordLabel')}</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t('mobileParity.userManagement.passwordPlaceholder')}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.role')}</Text>
            <View style={styles.roleSelector}>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  { backgroundColor: newRole === 'user' ? colors.primary : colors.border }
                ]}
                onPress={() => setNewRole('user')}
              >
                <Text style={[
                  styles.roleOptionText,
                  { color: newRole === 'user' ? '#fff' : colors.text }
                ]}>
                  {t('mobileParity.common.user')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  { backgroundColor: newRole === 'admin' ? colors.primary : colors.border }
                ]}
                onPress={() => setNewRole('admin')}
              >
                <Text style={[
                  styles.roleOptionText,
                  { color: newRole === 'admin' ? '#fff' : colors.text }
                ]}>
                  {t('mobileParity.common.admin')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{t('mobileParity.userManagement.billGroupAccess')}</Text>
            <View style={styles.databaseList}>
              {databases.map((db) => (
                <TouchableOpacity
                  key={db.id}
                  style={[
                    styles.databaseItem,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    selectedDatabases.includes(db.id) && { borderColor: colors.primary },
                  ]}
                  onPress={() => toggleDatabaseSelection(db.id)}
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
                onPress={() => setShowCreateModal(false)}
                disabled={isCreating}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>{t('mobileParity.common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }, isCreating && styles.buttonDisabled]}
                onPress={handleCreateUser}
                disabled={isCreating}
              >
                {isCreating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('mobileParity.common.create')}</Text>
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
  placeholder: {
    width: 60,
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    marginBottom: 12,
  },
  userCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  userInfo: {
    marginBottom: 12,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  email: {
    fontSize: 14,
    marginTop: 4,
  },
  date: {
    fontSize: 12,
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
  deleteButtonText: {
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
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
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
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
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
  roleSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  roleOption: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  roleOptionText: {
    fontSize: 16,
    fontWeight: '600',
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
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  addButton: {
    padding: 4,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  databaseList: {
    marginBottom: 16,
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
});
