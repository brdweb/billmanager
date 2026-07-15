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
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { DatabaseWithAccess, AdminUser } from '../types';

type Props = NativeStackScreenProps<any, 'DatabaseManagement'>;

export default function DatabaseManagementScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { refreshDatabases } = useAuth();
  const [databases, setDatabases] = useState<DatabaseWithAccess[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editingDatabase, setEditingDatabase] = useState<DatabaseWithAccess | null>(null);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // User access modal state
  const [showUserAccessModal, setShowUserAccessModal] = useState(false);
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseWithAccess | null>(null);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const fetchDatabases = useCallback(async () => {
    try {
      const response = await api.getDatabases();
      if (response.success && response.data) {
        setDatabases(response.data);
        setError(null);
      } else {
        setError(response.error || 'Failed to load bill groups');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases();
  }, [fetchDatabases]);

  useFocusEffect(
    useCallback(() => {
      fetchDatabases();
    }, [fetchDatabases])
  );

  // Update selected database when databases list changes
  useEffect(() => {
    if (selectedDatabase) {
      const updated = databases.find(d => d.id === selectedDatabase.id);
      if (updated) {
        setSelectedDatabase(updated);
      }
    }
  }, [databases]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchDatabases();
  }, [fetchDatabases]);

  const openCreateModal = () => {
    setEditingDatabase(null);
    setName('');
    setDisplayName('');
    setDescription('');
    setShowModal(true);
  };

  const openEditModal = (db: DatabaseWithAccess) => {
    setEditingDatabase(db);
    setName(db.name);
    setDisplayName(db.display_name);
    setDescription(db.description || '');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name');
      return;
    }

    if (!editingDatabase && !name.trim()) {
      Alert.alert('Error', 'Please enter an internal name');
      return;
    }

    setIsSubmitting(true);

    let result;
    if (editingDatabase) {
      result = await api.updateDatabase(editingDatabase.id, displayName.trim(), description.trim());
    } else {
      result = await api.createDatabase(name.trim(), displayName.trim(), description.trim());
    }

    setIsSubmitting(false);

    if (result.success) {
      setShowModal(false);
      fetchDatabases();
      refreshDatabases();
      Alert.alert('Success', editingDatabase ? 'Bill group updated' : 'Bill group created');
    } else {
      Alert.alert('Error', result.error || 'Failed to save bill group');
    }
  };

  const handleDelete = (db: DatabaseWithAccess) => {
    Alert.alert(
      'Delete Bill Group',
      `Are you sure you want to delete "${db.display_name}"? This will permanently delete all bills and payments in this group.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteDatabase(db.id);
            if (result.success) {
              fetchDatabases();
              refreshDatabases();
              Alert.alert('Success', 'Bill group deleted');
            } else {
              Alert.alert('Error', result.error || 'Failed to delete bill group');
            }
          },
        },
      ]
    );
  };

  const openUserAccessModal = async (db: DatabaseWithAccess) => {
    setSelectedDatabase(db);
    setShowUserAccessModal(true);
    setIsLoadingUsers(true);

    try {
      const response = await api.getUsers();
      if (response.success && response.data) {
        setAllUsers(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleAddUserAccess = async (userId: number) => {
    if (!selectedDatabase) return;

    const result = await api.addDatabaseAccess(selectedDatabase.id, userId);
    if (result.success) {
      fetchDatabases();
    } else {
      Alert.alert('Error', result.error || 'Failed to add user access');
    }
  };

  const handleRemoveUserAccess = async (userId: number, username: string) => {
    if (!selectedDatabase) return;

    Alert.alert(
      'Remove Access',
      `Remove ${username}'s access to "${selectedDatabase.display_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const result = await api.removeDatabaseAccess(selectedDatabase.id, userId);
            if (result.success) {
              fetchDatabases();
            } else {
              Alert.alert('Error', result.error || 'Failed to remove user access');
            }
          },
        },
      ]
    );
  };

  // Get users who don't have access to the selected database
  const getAvailableUsers = () => {
    if (!selectedDatabase) return [];
    const currentUserIds = selectedDatabase.users?.map(u => u.user_id) || [];
    return allUsers.filter(u => !currentUserIds.includes(u.id));
  };

  const renderDatabase = ({ item }: { item: DatabaseWithAccess }) => {
    const userCount = item.users?.length || 0;

    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={[styles.displayName, { color: colors.text }]}>{item.display_name}</Text>
            <Text style={[styles.internalName, { color: colors.textMuted }]}>{item.name}</Text>
          </View>
          <TouchableOpacity
            style={[styles.editButton, { backgroundColor: colors.border }]}
            onPress={() => openEditModal(item)}
          >
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        {userCount > 0 && (
          <View style={styles.usersSection}>
            <Text style={[styles.usersLabel, { color: colors.textMuted }]}>
              {userCount} user{userCount !== 1 ? 's' : ''} with access:
            </Text>
            <View style={styles.usersList}>
              {item.users?.map((user) => (
                <View
                  key={user.user_id}
                  style={[styles.userChip, { backgroundColor: colors.border }]}
                >
                  <Text style={[styles.userChipText, { color: colors.text }]}>
                    {user.username}
                  </Text>
                  <Text style={[styles.userRoleText, { color: colors.textMuted }]}>
                    ({user.role})
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.manageUsersButton, { backgroundColor: colors.primary }]}
            onPress={() => openUserAccessModal(item)}
          >
            <Text style={styles.manageUsersButtonText}>Manage Users</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.deleteButton, { backgroundColor: colors.danger }]}
            onPress={() => handleDelete(item)}
          >
            <Text style={styles.deleteButtonText}>Delete Group</Text>
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
          <Text style={[styles.backButtonText, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Bill Groups</Text>
        <TouchableOpacity onPress={openCreateModal} style={styles.addButton}>
          <Text style={[styles.addButtonText, { color: colors.primary }]}>+ New</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={fetchDatabases}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={databases}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderDatabase}
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
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No bill groups yet</Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                Tap "+ New" to create your first group
              </Text>
            </View>
          }
          ListHeaderComponent={
            databases.length > 0 ? (
              <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
                {databases.length} bill group{databases.length !== 1 ? 's' : ''}
              </Text>
            ) : null
          }
        />
      )}

      {/* Create/Edit Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingDatabase ? 'Edit Bill Group' : 'New Bill Group'}
            </Text>

            {!editingDatabase && (
              <>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Internal Name</Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="personal, business, etc."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                <Text style={[styles.inputHint, { color: colors.textMuted }]}>
                  Cannot be changed after creation
                </Text>
              </>
            )}

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Display Name</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Personal Bills, Business Expenses, etc."
              placeholderTextColor={colors.textMuted}
            />

            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Description (optional)</Text>
            <TextInput
              style={[styles.input, {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What this bill group is for"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setShowModal(false)}
                disabled={isSubmitting}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.primary }, isSubmitting && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    {editingDatabase ? 'Save' : 'Create'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* User Access Modal */}
      <Modal
        visible={showUserAccessModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowUserAccessModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '80%' }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Manage Access
            </Text>
            {selectedDatabase && (
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                {selectedDatabase.display_name}
              </Text>
            )}

            {isLoadingUsers ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.userAccessContainer}>
                {/* Current users with access */}
                {selectedDatabase?.users && selectedDatabase.users.length > 0 && (
                  <View style={styles.userAccessSection}>
                    <Text style={[styles.userAccessSectionTitle, { color: colors.text }]}>
                      Users with access
                    </Text>
                    {selectedDatabase.users.map((user) => (
                      <View
                        key={user.user_id}
                        style={[styles.userAccessRow, { backgroundColor: colors.background }]}
                      >
                        <View>
                          <Text style={[styles.userAccessName, { color: colors.text }]}>
                            {user.username}
                          </Text>
                          <Text style={[styles.userAccessRole, { color: colors.textMuted }]}>
                            {user.role}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.removeAccessButton, { backgroundColor: colors.danger }]}
                          onPress={() => handleRemoveUserAccess(user.user_id, user.username)}
                        >
                          <Text style={styles.removeAccessButtonText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Available users to add */}
                {getAvailableUsers().length > 0 && (
                  <View style={styles.userAccessSection}>
                    <Text style={[styles.userAccessSectionTitle, { color: colors.text }]}>
                      Add users
                    </Text>
                    {getAvailableUsers().map((user) => (
                      <View
                        key={user.id}
                        style={[styles.userAccessRow, { backgroundColor: colors.background }]}
                      >
                        <View>
                          <Text style={[styles.userAccessName, { color: colors.text }]}>
                            {user.username}
                          </Text>
                          <Text style={[styles.userAccessRole, { color: colors.textMuted }]}>
                            {user.role}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.addAccessButton, { backgroundColor: colors.success }]}
                          onPress={() => handleAddUserAccess(user.id)}
                        >
                          <Text style={styles.addAccessButtonText}>Add</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {selectedDatabase?.users?.length === 0 && getAvailableUsers().length === 0 && (
                  <Text style={[styles.noUsersText, { color: colors.textMuted }]}>
                    No users available
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.border }]}
              onPress={() => setShowUserAccessModal(false)}
            >
              <Text style={[styles.closeButtonText, { color: colors.text }]}>Done</Text>
            </TouchableOpacity>
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
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    marginBottom: 12,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 18,
    fontWeight: '600',
  },
  internalName: {
    fontSize: 13,
    marginTop: 2,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  usersSection: {
    marginBottom: 12,
  },
  usersLabel: {
    fontSize: 13,
    marginBottom: 8,
  },
  usersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  userChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  userRoleText: {
    fontSize: 11,
  },
  cardActions: {
    marginTop: 8,
    gap: 8,
  },
  manageUsersButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  manageUsersButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  deleteButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
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
  inputHint: {
    fontSize: 12,
    marginTop: -12,
    marginBottom: 16,
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
  // User access modal styles
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    marginTop: -16,
  },
  userAccessContainer: {
    marginBottom: 16,
  },
  userAccessSection: {
    marginBottom: 16,
  },
  userAccessSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  userAccessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  userAccessName: {
    fontSize: 16,
    fontWeight: '500',
  },
  userAccessRole: {
    fontSize: 12,
    marginTop: 2,
  },
  removeAccessButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  removeAccessButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  addAccessButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addAccessButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  noUsersText: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 20,
  },
  closeButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
