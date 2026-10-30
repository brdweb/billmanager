import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyRound, MailPlus, Pencil, Plus, RefreshCw, Shield, Trash2, UserCog, Users, UserX } from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import SectionHeader from '../../components/adaptive/SectionHeader';
import SegmentedControl from '../../components/adaptive/SegmentedControl';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAndroidTopInset } from '../../design/useAndroidTopInset';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import {
  AdminGroupItem,
  AdminInviteItem,
  AdminSection,
  AdminUserItem,
  AdministrationActions,
  AdministrationViewModel,
} from './models';
import { useTranslation } from 'react-i18next';

export interface AdministrationScreenProps {
  model: AdministrationViewModel;
  actions: AdministrationActions;
  platform?: AdaptivePlatform;
}

function StatusPanel({ platform, title, body, loading, onRetry }: { platform: AdaptivePlatform; title: string; body: string; loading?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.state, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator accessibilityLabel={t('mobileParity.administration.loadingTitle')} size="large" color={theme.colors.primary} /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.65 : 1 }]}><Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text></Pressable> : null}
    </View>
  );
}

function ActionIcon({ label, color, icon, disabled, onPress, platform }: { label: string; color: string; icon: React.ReactNode; disabled: boolean; onPress: () => void; platform: AdaptivePlatform }) {
  const theme = useAdaptiveTheme(platform);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionIcon, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}
    >
      {icon}
      <Text style={[styles.visuallyCompactLabel, { color }]}>{label.split(' ')[0]}</Text>
    </Pressable>
  );
}

function UserRow({ user, offline, actions, platform, isLast }: { user: AdminUserItem; offline: boolean; actions: AdministrationActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const disabled = offline;
  const statusLabel = t(user.status === 'suspended' ? 'mobileParity.administration.statusSuspended' : user.status === 'pending-password-change' ? 'mobileParity.administration.statusPasswordChange' : 'mobileParity.administration.statusActive');
  return (
    <View style={[styles.row, !isLast && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={[styles.leadingIcon, { backgroundColor: user.status === 'suspended' ? theme.colors.accentContainer : theme.colors.primaryContainer }]}>{user.status === 'suspended' ? <UserX size={21} color={theme.colors.accent} /> : <UserCog size={21} color={theme.colors.primary} />}</View>
      <View accessible accessibilityLabel={t('mobileParity.administration.userA11y', { name: user.displayName, email: user.email, role: user.role, status: statusLabel, groups: user.groupNames.length ? user.groupNames.join(', ') : t('mobileParity.administration.noGroups'), lastLogin: user.lastLoginLabel ? `, ${t('mobileParity.administration.lastLogin', { date: user.lastLoginLabel })}` : '' })} style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={[typography.headline, styles.flexText, { color: theme.colors.text }]}>{user.displayName}</Text>
          <View style={[styles.roleBadge, { backgroundColor: user.role === 'owner' ? theme.colors.primaryContainer : theme.colors.surfaceMuted }]}><Text style={[typography.caption, { color: user.role === 'owner' ? theme.colors.primary : theme.colors.textSecondary }]}>{user.role}</Text></View>
        </View>
        <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textMuted }]}>{user.email}</Text>
        <Text numberOfLines={2} style={[typography.caption, { color: user.status === 'suspended' ? theme.colors.accent : theme.colors.textSecondary }]}>{statusLabel} · {user.groupNames.length ? user.groupNames.join(', ') : t('mobileParity.administration.noGroups')}{user.lastLoginLabel ? ` · ${user.lastLoginLabel}` : ''}</Text>
      </View>
      <View style={styles.rowActions}>
        {user.permissions.edit ? <ActionIcon platform={platform} label={t('mobileParity.administration.editA11y', { name: user.displayName })} color={theme.colors.primary} icon={<Pencil size={18} color={theme.colors.primary} />} disabled={disabled} onPress={() => actions.onEditUser(user.id)} /> : null}
        {user.permissions.changeAccess ? <ActionIcon platform={platform} label={t('mobileParity.administration.accessA11y', { name: user.displayName })} color={theme.colors.primary} icon={<KeyRound size={18} color={theme.colors.primary} />} disabled={disabled} onPress={() => actions.onChangeUserAccess(user.id)} /> : null}
        {user.permissions.delete ? <ActionIcon platform={platform} label={t('mobileParity.administration.deleteA11y', { name: user.displayName })} color={theme.colors.danger} icon={<Trash2 size={18} color={theme.colors.danger} />} disabled={disabled} onPress={() => actions.onDeleteUser(user.id)} /> : null}
      </View>
    </View>
  );
}

function InviteRow({ invite, offline, actions, platform, isLast }: { invite: AdminInviteItem; offline: boolean; actions: AdministrationActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.row, !isLast && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={[styles.leadingIcon, { backgroundColor: theme.colors.surfaceMuted }]}><MailPlus size={21} color={theme.colors.primary} /></View>
      <View accessible accessibilityLabel={t('mobileParity.administration.invitedA11y', { email: invite.email, role: invite.role, name: invite.invitedByName, groups: invite.groupNames.length ? invite.groupNames.join(', ') : t('mobileParity.administration.noGroups'), sent: invite.sentLabel, expires: invite.expiresLabel })} style={styles.rowCopy}>
        <View style={styles.titleLine}><Text numberOfLines={1} style={[typography.headline, styles.flexText, { color: theme.colors.text }]}>{invite.email}</Text><View style={[styles.roleBadge, { backgroundColor: theme.colors.surfaceMuted }]}><Text style={[typography.caption, { color: theme.colors.textSecondary }]}>{invite.role}</Text></View></View>
        <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted }]}>{invite.groupNames.length ? invite.groupNames.join(', ') : t('mobileParity.administration.noGroups')} · {invite.sentLabel} · {invite.expiresLabel}</Text>
      </View>
      <View style={styles.rowActions}>
        {invite.canResend ? <ActionIcon platform={platform} label={t('mobileParity.administration.resendA11y', { email: invite.email })} color={theme.colors.primary} icon={<RefreshCw size={18} color={theme.colors.primary} />} disabled={offline} onPress={() => actions.onResendInvite(invite.id)} /> : null}
        {invite.canRevoke ? <ActionIcon platform={platform} label={t('mobileParity.administration.revokeA11y', { email: invite.email })} color={theme.colors.danger} icon={<Trash2 size={18} color={theme.colors.danger} />} disabled={offline} onPress={() => actions.onRevokeInvite(invite.id)} /> : null}
      </View>
    </View>
  );
}

function GroupRow({ group, offline, actions, platform, isLast }: { group: AdminGroupItem; offline: boolean; actions: AdministrationActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.row, !isLast && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={[styles.leadingIcon, { backgroundColor: theme.colors.primaryContainer }]}><Users size={21} color={theme.colors.primary} /></View>
      <View accessible accessibilityLabel={t('mobileParity.administration.groupA11y', { name: group.name, members: t('mobileParity.administration.member', { count: group.memberCount }), owners: t('mobileParity.administration.owner', { count: group.ownerCount }), database: group.databaseName ? t('mobileParity.administration.databaseA11y', { name: group.databaseName }) : '' })} style={styles.rowCopy}>
        <Text numberOfLines={1} style={[typography.headline, { color: theme.colors.text }]}>{group.name}</Text>
        <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.administration.member', { count: group.memberCount })} · {t('mobileParity.administration.owner', { count: group.ownerCount })}{group.databaseName ? ` · ${group.databaseName}` : ''}</Text>
      </View>
      <View style={styles.rowActions}>
        {group.permissions.edit ? <ActionIcon platform={platform} label={t('mobileParity.administration.editA11y', { name: group.name })} color={theme.colors.primary} icon={<Pencil size={18} color={theme.colors.primary} />} disabled={offline} onPress={() => actions.onEditGroup(group.id)} /> : null}
        {group.permissions.changeAccess ? <ActionIcon platform={platform} label={t('mobileParity.administration.manageAccessA11y', { name: group.name })} color={theme.colors.primary} icon={<Shield size={18} color={theme.colors.primary} />} disabled={offline} onPress={() => actions.onManageGroupAccess(group.id)} /> : null}
        {group.permissions.delete ? <ActionIcon platform={platform} label={t('mobileParity.administration.deleteA11y', { name: group.name })} color={theme.colors.danger} icon={<Trash2 size={18} color={theme.colors.danger} />} disabled={offline} onPress={() => actions.onDeleteGroup(group.id)} /> : null}
      </View>
    </View>
  );
}

export default function AdministrationScreen({ model, actions, platform = Platform.OS === 'ios' ? 'ios' : 'android' }: AdministrationScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  const topInset = useAndroidTopInset(platform);
  if (model.status === 'loading') return <StatusPanel platform={platform} title={t('mobileParity.administration.loadingTitle')} body={t('mobileParity.administration.loadingBody')} loading />;
  if (model.status === 'error') return <StatusPanel platform={platform} title={t('mobileParity.administration.unavailableTitle')} body={model.errorMessage ?? t('mobileParity.administration.unavailableBody')} onRetry={actions.onRetry} />;
  if (model.status === 'permission-denied') return <StatusPanel platform={platform} title={t('mobileParity.administration.restrictedTitle')} body={model.permissionMessage ?? t('mobileParity.administration.restrictedBody')} />;
  if (model.offline) return <StatusPanel platform={platform} title={t('mobileParity.administration.connectionTitle')} body={t('mobileParity.administration.connectionFreshBody')} />;

  const rows = model.selectedSection === 'users' ? model.users : model.selectedSection === 'invites' ? model.invites : model.groups;
  const createAllowed = model.selectedSection === 'users' ? model.canCreateUsers : model.selectedSection === 'invites' ? model.canCreateInvites : model.canCreateGroups;
  const createLabel = model.selectedSection === 'users' ? t('mobileParity.administration.addUser') : model.selectedSection === 'invites' ? t('mobileParity.administration.inviteUser') : t('mobileParity.administration.addGroup');
  const createAction = model.selectedSection === 'users' ? actions.onCreateUser : model.selectedSection === 'invites' ? actions.onCreateInvite : actions.onCreateGroup;
  const sectionTitle: Record<AdminSection, string> = { users: t('mobileParity.administration.users'), invites: t('mobileParity.administration.pendingInvites'), groups: t('mobileParity.administration.groupsAccess') };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }, topInset > 0 && { paddingTop: topInset }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth }]}
      >
        <View style={styles.heading}>
          <View style={[styles.leadingIcon, { backgroundColor: theme.colors.primaryContainer }]}><Shield size={22} color={theme.colors.primary} /></View>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('mobileParity.administration.title')}</Text>
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileParity.administration.manageAs', { role: model.currentUserRole })}</Text>
          </View>
        </View>

        <SegmentedControl
          platform={platform}
          label={t('mobileParity.administration.section')}
          value={model.selectedSection}
          onChange={actions.onChangeSection}
          options={[{ value: 'users', label: t('mobileParity.administration.usersCount', { count: model.users.length }) }, { value: 'invites', label: t('mobileParity.administration.invitesCount', { count: model.invites.length }) }, { value: 'groups', label: t('mobileParity.administration.groupsCount', { count: model.groups.length }) }]}
        />

        <View style={styles.sectionHeaderRow}>
          <SectionHeader platform={platform} title={sectionTitle[model.selectedSection]} />
          {createAllowed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={createLabel}
              accessibilityState={{ disabled: model.offline }}
              disabled={model.offline}
              onPress={createAction}
              style={({ pressed }) => [styles.addButton, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, borderRadius: platform === 'ios' ? 12 : 16, opacity: model.offline ? 0.4 : pressed ? 0.7 : 1 }]}
            ><Plus size={18} color={theme.colors.onPrimary} /><Text style={[typography.callout, { color: theme.colors.onPrimary, fontWeight: '700' }]}>{createLabel}</Text></Pressable>
          ) : null}
        </View>

        {rows.length === 0 ? (
          <AdaptiveSurface style={styles.empty}>
            <Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.administration.noItems', { section: sectionTitle[model.selectedSection].toLocaleLowerCase() })}</Text>
            <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{createAllowed ? t('mobileParity.administration.startWith', { action: createLabel }) : t('mobileParity.administration.nothing')}</Text>
          </AdaptiveSurface>
        ) : (
          <AdaptiveSurface>
            {model.selectedSection === 'users' ? model.users.map((user, index) => <UserRow key={user.id} user={user} offline={model.offline} actions={actions} platform={platform} isLast={index === model.users.length - 1} />) : null}
            {model.selectedSection === 'invites' ? model.invites.map((invite, index) => <InviteRow key={invite.id} invite={invite} offline={model.offline} actions={actions} platform={platform} isLast={index === model.invites.length - 1} />) : null}
            {model.selectedSection === 'groups' ? model.groups.map((group, index) => <GroupRow key={group.id} group={group} offline={model.offline} actions={actions} platform={platform} isLast={index === model.groups.length - 1} />) : null}
          </AdaptiveSurface>
        )}

        <Text style={[typography.caption, styles.auditCopy, { color: theme.colors.textMuted }]}>{t('mobileParity.administration.audit')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  state: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centered: { textAlign: 'center', maxWidth: 460 },
  retry: { marginTop: 8, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', alignSelf: 'center', paddingTop: 20, paddingBottom: 52, gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingCopy: { minWidth: 0, flex: 1, gap: 3 },
  offline: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  addButton: { paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  empty: { padding: 28, alignItems: 'center', gap: 7 },
  row: { minHeight: 84, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadingIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { minWidth: 0, flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  flexText: { minWidth: 0, flexShrink: 1 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
  actionIcon: { alignItems: 'center', justifyContent: 'center', gap: 1 },
  visuallyCompactLabel: { maxWidth: 54, fontSize: 10, lineHeight: 12, fontWeight: '600' },
  auditCopy: { paddingTop: 4, textAlign: 'center' },
});
