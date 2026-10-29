import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useServerProfiles } from '../context/ServerProfileContext';
import { useMobileRuntime } from '../context/MobileRuntimeContext';
import { useTheme } from '../context/ThemeContext';
import { getLegacyDataStatus, legacyNoticeKind } from '../data/legacyQuarantine';

export default function LegacyDataNotice() {
  const { isAuthenticated, requiresOnlineIdentityVerification } = useAuth();
  const { activeProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['legacy-quarantine', activeProfile.id],
    enabled: isAuthenticated, queryFn: () => getLegacyDataStatus(activeProfile.id) });
  const kind = requiresOnlineIdentityVerification ? 'verifyAccount'
    : query.error ? 'recovery' : legacyNoticeKind(query.data, runtime.lastSyncedAt);
  if ((!isAuthenticated && !requiresOnlineIdentityVerification) || !kind) return null;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: colors.surface }}>
      <View style={[styles.notice, { borderColor: colors.warning }]}>
        <Text accessibilityRole="alert" style={[styles.text, { color: colors.text }]}>
          {t(`mobileCore.recovery.${kind}`)}
        </Text>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => Alert.alert(t('mobileCore.recovery.help'), t('mobileCore.recovery.guidance'))}>
          <Text style={[styles.link, { color: colors.primary }]}>{t('mobileCore.recovery.help')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  notice: { paddingHorizontal: 16, paddingTop: 8, borderBottomWidth: 1 },
  text: { fontSize: 16, lineHeight: 24 },
  action: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 16 },
  link: { fontSize: 16, fontWeight: '600' },
});
