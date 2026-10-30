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
import { Check, ChevronRight, Mail, Pencil, Plus, Share2, Trash2, UserRoundX, Users, X } from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import MoneyText from '../../components/adaptive/MoneyText';
import SectionHeader from '../../components/adaptive/SectionHeader';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAndroidTopInset } from '../../design/useAndroidTopInset';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import {
  CollaborationActions,
  CollaborationViewModel,
  ShareInviteItem,
  SharedBillItem,
} from './models';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export interface CollaborationScreenProps {
  model: CollaborationViewModel;
  actions: CollaborationActions;
  platform?: AdaptivePlatform;
}

function money(value: number, model: Pick<CollaborationViewModel, 'locale' | 'currency'>): string {
  return new Intl.NumberFormat(model.locale, { style: 'currency', currency: model.currency }).format(value);
}

function localizedSplit(t: TFunction, mode: 'equal' | 'percentage' | 'fixed', participantCount: number, sharePercent: number | undefined, fixedAmount: number | undefined, model: Pick<CollaborationViewModel, 'locale' | 'currency'>): string {
  if (mode === 'equal') return t('mobileParity.collaboration.equalSplit', { count: participantCount });
  if (mode === 'percentage') return t('mobileParity.collaboration.percentageSplit', { value: (sharePercent ?? 0).toFixed(1) });
  return t('mobileParity.collaboration.fixedSplit', { amount: money(fixedAmount ?? 0, model) });
}

function StatusPanel({ platform, title, body, loading, onRetry }: { platform: AdaptivePlatform; title: string; body: string; loading?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.state, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator accessibilityLabel={t('mobileParity.collaboration.loadingTitle')} size="large" color={theme.colors.primary} /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InviteRow({ invite, model, actions, platform, isLast }: { invite: ShareInviteItem; model: CollaborationViewModel; actions: CollaborationActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const incoming = invite.direction === 'incoming';
  const split = localizedSplit(t, invite.splitMode, 2, invite.sharePercent, invite.shareAmount, model);
  return (
    <View style={[styles.inviteRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
      <View style={[styles.iconBox, { backgroundColor: incoming ? theme.colors.primaryContainer : theme.colors.surfaceMuted }]}><Mail size={21} color={theme.colors.primary} /></View>
      <View
        accessible
        accessibilityLabel={`${incoming ? t('mobileParity.collaboration.invitationFrom', { name: invite.invitedByName }) : t('mobileParity.collaboration.invitationSent', { email: invite.invitedEmail })} · ${invite.billName} · ${split} · ${invite.expiresLabel}`}
        style={styles.inviteCopy}
      >
        <Text numberOfLines={1} style={[typography.headline, { color: theme.colors.text }]}>{invite.billName}</Text>
        <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted }]}>{incoming ? t('mobileParity.collaboration.from', { name: invite.invitedByName }) : t('mobileParity.collaboration.sentTo', { email: invite.invitedEmail })} · {split} · {invite.expiresLabel}</Text>
      </View>
      <View style={styles.inlineActions}>
        {incoming ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobileParity.collaboration.acceptA11y', { name: invite.billName })}
              accessibilityState={{ disabled: model.offline }}
              disabled={model.offline}
              onPress={() => actions.onAcceptInvite(invite.id)}
              style={({ pressed }) => [styles.iconAction, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: model.offline ? 0.4 : pressed ? 0.5 : 1 }]}
            ><Check size={20} color={theme.colors.success} /></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobileParity.collaboration.declineA11y', { name: invite.billName })}
              accessibilityState={{ disabled: model.offline }}
              disabled={model.offline}
              onPress={() => actions.onDeclineInvite(invite.id)}
              style={({ pressed }) => [styles.iconAction, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: model.offline ? 0.4 : pressed ? 0.5 : 1 }]}
            ><X size={20} color={theme.colors.danger} /></Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.collaboration.revokeInviteA11y', { email: invite.invitedEmail })}
            accessibilityState={{ disabled: model.offline }}
            disabled={model.offline}
            onPress={() => actions.onRevokeInvite(invite.id)}
            style={({ pressed }) => [styles.iconAction, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: model.offline ? 0.4 : pressed ? 0.5 : 1 }]}
          ><Trash2 size={19} color={theme.colors.danger} /></Pressable>
        )}
      </View>
    </View>
  );
}

function SharedBillRow({ bill, model, actions, platform, isLast }: { bill: SharedBillItem; model: CollaborationViewModel; actions: CollaborationActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const split = localizedSplit(t, bill.splitMode, bill.participants.length, bill.participants.find((participant) => !participant.owner)?.sharePercent, bill.myShareAmount, model);
  return (
    <View style={[styles.billRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('mobileParity.collaboration.openA11y', { name: bill.billName, owner: t('mobileParity.collaboration.ownedBy', { name: bill.ownerName }), share: money(bill.myShareAmount, model), total: money(bill.totalAmount, model), split, due: bill.dueLabel, pending: bill.pendingSync ? `, ${t('mobileParity.common.pendingSync')}` : '' })} onPress={() => actions.onOpenSharedBill(bill.billId)} style={({ pressed }) => [styles.billMain, { opacity: pressed ? 0.55 : 1 }]}>
        <View style={[styles.iconBox, { backgroundColor: theme.colors.primaryContainer }]}><Users size={21} color={theme.colors.primary} /></View>
        <View style={styles.billCopy}>
          <View style={styles.billTitleRow}>
            <Text numberOfLines={1} style={[typography.headline, styles.billTitle, { color: theme.colors.text }]}>{bill.billName}</Text>
            {bill.pendingSync ? <Text style={[typography.caption, { color: theme.colors.accent }]}>{t('mobileParity.common.pending')}</Text> : null}
          </View>
          <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted }]}>{split} · {t('mobileParity.collaboration.people', { count: bill.participants.length })} · {bill.dueLabel}</Text>
        </View>
        <View style={styles.shareAmount}>
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.collaboration.yourShare')}</Text>
          <MoneyText platform={platform} amount={bill.myShareAmount} style={styles.billAmount} />
        </View>
        <ChevronRight size={19} color={theme.colors.textMuted} />
      </Pressable>
      {bill.canManage ? (
        <View style={styles.manageActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.collaboration.editSplitA11y', { name: bill.billName })}
            accessibilityState={{ disabled: model.offline }}
            disabled={model.offline}
            onPress={() => actions.onEditSplit(bill.shareId)}
            style={({ pressed }) => [styles.manageButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.border, opacity: model.offline ? 0.4 : pressed ? 0.55 : 1 }]}
          ><Pencil size={17} color={theme.colors.primary} /><Text style={[typography.callout, { color: theme.colors.primary }]}>{t('mobileParity.collaboration.editSplit')}</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.collaboration.stopSharingA11y', { name: bill.billName })}
            accessibilityState={{ disabled: model.offline }}
            accessibilityHint={t('mobileParity.collaboration.revokeHint')}
            disabled={model.offline}
            onPress={() => actions.onRevokeShare(bill.shareId)}
            style={({ pressed }) => [styles.manageButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.border, opacity: model.offline ? 0.4 : pressed ? 0.55 : 1 }]}
          ><UserRoundX size={17} color={theme.colors.danger} /><Text style={[typography.callout, { color: theme.colors.danger }]}>{t('mobileParity.collaboration.revoke')}</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function CollaborationScreen({ model, actions, platform = Platform.OS === 'ios' ? 'ios' : 'android' }: CollaborationScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  const topInset = useAndroidTopInset(platform);
  if (model.status === 'loading') return <StatusPanel platform={platform} title={t('mobileParity.collaboration.loadingTitle')} body={t('mobileParity.collaboration.loadingBody')} loading />;
  if (model.status === 'error') return <StatusPanel platform={platform} title={t('mobileParity.collaboration.unavailableTitle')} body={model.errorMessage ?? t('mobileParity.collaboration.unavailableBody')} onRetry={actions.onRetry} />;
  if (model.status === 'permission-denied') return <StatusPanel platform={platform} title={t('mobileParity.collaboration.restrictedTitle')} body={model.permissionMessage ?? t('mobileParity.collaboration.restrictedBody')} />;

  const empty = model.sharedBills.length === 0 && model.pendingInvites.length === 0;
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }, topInset > 0 && { paddingTop: topInset }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth }]}
      >
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('mobileCore.insights.sharedBills')}</Text>
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileParity.collaboration.subtitle', { bucket: model.bucketLabel })}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.collaboration.shareA11y')}
            accessibilityState={{ disabled: model.offline }}
            disabled={model.offline}
            onPress={actions.onAddShare}
            style={({ pressed }) => [styles.addButton, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: model.offline ? 0.4 : pressed ? 0.72 : 1, borderRadius: platform === 'ios' ? 12 : 16 }]}
          >
            <Plus size={19} color={theme.colors.onPrimary} />
            <Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.collaboration.shareBill')}</Text>
          </Pressable>
        </View>

        {model.offline ? <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: theme.colors.accentContainer }]}><Text style={[typography.callout, { color: theme.colors.accent }]}>{t('mobileParity.collaboration.offlineSaved', { updated: model.lastUpdatedLabel ? ` · ${model.lastUpdatedLabel}` : '' })}</Text></View> : null}

        {empty ? (
          <AdaptiveSurface style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primaryContainer }]}><Share2 size={26} color={theme.colors.primary} /></View>
            <Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.collaboration.emptyTitle')}</Text>
            <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{t('mobileParity.collaboration.emptyBody')}</Text>
          </AdaptiveSurface>
        ) : (
          <>
            {model.pendingInvites.length ? (
              <>
                <SectionHeader platform={platform} title={t('mobileParity.collaboration.pendingInvites', { count: model.pendingInvites.length })} />
                <AdaptiveSurface>{model.pendingInvites.map((invite, index) => <InviteRow key={invite.id} invite={invite} model={model} actions={actions} platform={platform} isLast={index === model.pendingInvites.length - 1} />)}</AdaptiveSurface>
              </>
            ) : null}

            <SectionHeader platform={platform} title={t('mobileParity.collaboration.sharedBills', { count: model.sharedBills.length })} />
            {model.sharedBills.length ? (
              <AdaptiveSurface>{model.sharedBills.map((bill, index) => <SharedBillRow key={bill.shareId} bill={bill} model={model} actions={actions} platform={platform} isLast={index === model.sharedBills.length - 1} />)}</AdaptiveSurface>
            ) : <Text style={[typography.body, styles.noRows, { color: theme.colors.textMuted }]}>{t('mobileParity.collaboration.noActive')}</Text>}
          </>
        )}
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
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleCopy: { minWidth: 220, flex: 1, gap: 3 },
  addButton: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  offline: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  empty: { padding: 30, alignItems: 'center', gap: 7 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  noRows: { textAlign: 'center', paddingVertical: 16 },
  inviteRow: { minHeight: 82, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inviteCopy: { minWidth: 0, flex: 1, gap: 2 },
  inlineActions: { flexDirection: 'row', alignItems: 'center' },
  iconAction: { alignItems: 'center', justifyContent: 'center' },
  billRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 5 },
  billMain: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10 },
  billCopy: { minWidth: 0, flex: 1, gap: 2 },
  billTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  billTitle: { minWidth: 0, flexShrink: 1 },
  shareAmount: { alignItems: 'flex-end', gap: 1 },
  billAmount: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  manageActions: { alignSelf: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  manageButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
