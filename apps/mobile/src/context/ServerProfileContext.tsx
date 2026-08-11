import Constants from 'expo-constants';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import {
  maximumSupportedMobileContract,
  minimumSupportedMobileContract,
  MobileContractError,
} from '../api/capabilities';
import { profileForUrl } from '../api/serverUrl';
import { SQLiteServerProfileStore } from '../data/profileRepository';
import { defaultCloudProfile, type PersistedServerProfile } from '../domain/serverProfile';
import { requiresMobileUpgrade } from '../domain/versionCompatibility';
import { configureFormatting } from '../i18n/format';
import { hydrateLanguage } from '../i18n';
import { shouldDeferInitialReady } from './initialProfileReadiness';
import {
  ProfileOperationGuard,
  ProfileOperationSupersededError,
  type ProfileOperationToken,
} from './profileOperationGuard';

export interface MobileCompatibility {
  kind: 'minimum_mobile_version' | 'mobile_contract';
  currentVersion: string;
  minimumVersion: string | null;
  serverVersion: string;
  message: string | null;
  contractVersion?: number | null;
  supportedContractVersion?: number;
  contractAction?: 'update_server' | 'update_app';
}

interface ServerProfileContextValue {
  profiles: PersistedServerProfile[];
  activeProfile: PersistedServerProfile;
  loading: boolean;
  verifying: boolean;
  error: string | null;
  compatibility: MobileCompatibility | null;
  addProfile: (input: { displayName?: string; baseUrl: string }) => Promise<PersistedServerProfile>;
  switchProfile: (profileId: string) => Promise<void>;
  verifyActiveProfile: () => Promise<PersistedServerProfile>;
  refreshProfiles: () => Promise<void>;
}

const ServerProfileContext = createContext<ServerProfileContextValue | null>(null);
const profileStore = new SQLiteServerProfileStore();
let profileLocalizationTail: Promise<void> = Promise.resolve();

function appVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

async function applyProfileLocalization(profile: PersistedServerProfile): Promise<void> {
  const language = await hydrateLanguage(profile.capabilities?.defaultLocale);
  configureFormatting(
    profile.capabilities?.defaultLocale,
    profile.capabilities?.defaultCurrency,
    language,
  );
}

async function serializeProfileLocalization(
  profile: PersistedServerProfile,
  shouldApply: () => boolean,
): Promise<void> {
  const operation = profileLocalizationTail.catch(() => undefined).then(async () => {
    if (!shouldApply()) return;
    await applyProfileLocalization(profile);
  });
  profileLocalizationTail = operation.then(() => undefined, () => undefined);
  await operation;
}

function compatibilityFor(profile: PersistedServerProfile): MobileCompatibility | null {
  const contractVersion = profile.capabilities?.mobileContractVersion;
  if (
    contractVersion !== undefined
    && (
      contractVersion < minimumSupportedMobileContract
      || contractVersion > maximumSupportedMobileContract
    )
  ) {
    return {
      kind: 'mobile_contract',
      currentVersion: appVersion(),
      minimumVersion: null,
      serverVersion: profile.capabilities?.serverVersion ?? 'unknown',
      message: `This server uses mobile contract ${contractVersion}; this app supports contract ${maximumSupportedMobileContract}.`,
      contractVersion,
      supportedContractVersion: maximumSupportedMobileContract,
      contractAction: contractVersion > maximumSupportedMobileContract ? 'update_app' : 'update_server',
    };
  }
  const minimumVersion = profile.capabilities?.minimumMobileVersion;
  const currentVersion = appVersion();
  if (!minimumVersion || !requiresMobileUpgrade(currentVersion, minimumVersion)) return null;
  return {
    kind: 'minimum_mobile_version',
    currentVersion,
    minimumVersion,
    serverVersion: profile.capabilities?.serverVersion ?? 'unknown',
    message: null,
  };
}

function compatibilityForContractError(
  reason: MobileContractError,
  profile: PersistedServerProfile,
): MobileCompatibility {
  return {
    kind: 'mobile_contract',
    currentVersion: appVersion(),
    minimumVersion: null,
    serverVersion: profile.capabilities?.serverVersion ?? 'unknown',
    message: reason.message,
    contractVersion: reason.contractVersion,
    supportedContractVersion: maximumSupportedMobileContract,
    contractAction: reason.contractVersion !== null && reason.contractVersion > maximumSupportedMobileContract
      ? 'update_app'
      : 'update_server',
  };
}

export function ServerProfileProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<PersistedServerProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<PersistedServerProfile>(defaultCloudProfile());
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compatibility, setCompatibility] = useState<MobileCompatibility | null>(null);
  const operationGuard = useRef(new ProfileOperationGuard(defaultCloudProfile().id)).current;
  const mountedRef = useRef(true);

  const canApplyProfile = useCallback((
    token: ProfileOperationToken,
    profileId: string,
  ): boolean => (
    mountedRef.current
      && operationGuard.isCurrent(token, profileId)
      && api.getActiveProfile().id === profileId
  ), [operationGuard]);

  const refreshProfilesForToken = useCallback(async (
    token: ProfileOperationToken,
    fallbackProfile?: PersistedServerProfile,
  ): Promise<boolean> => {
    const stored = await profileStore.list();
    const current = api.getActiveProfile();
    if (!canApplyProfile(token, current.id)) return false;
    setProfiles(stored.length > 0 ? stored : [fallbackProfile ?? current]);
    return true;
  }, [canApplyProfile]);

  const refreshProfiles = useCallback(async () => {
    const current = api.getActiveProfile();
    const token = operationGuard.capture();
    if (!canApplyProfile(token, current.id)) return;
    await refreshProfilesForToken(token, current);
  }, [canApplyProfile, operationGuard, refreshProfilesForToken]);

  const applyProfileSnapshot = useCallback(async (
    profile: PersistedServerProfile,
    token: ProfileOperationToken,
  ): Promise<boolean> => {
    if (!canApplyProfile(token, profile.id)) return false;
    setActiveProfile(profile);
    setCompatibility(compatibilityFor(profile));

    // Language and formatting are process-global. Serialize them so a slow A
    // hydration cannot finish after B and leave global locale state on A.
    await serializeProfileLocalization(
      profile,
      () => canApplyProfile(token, profile.id),
    ).catch(() => undefined);
    if (!canApplyProfile(token, profile.id)) return false;

    try {
      return await refreshProfilesForToken(token, profile);
    } catch {
      if (!canApplyProfile(token, profile.id)) return false;
      setProfiles([profile]);
      return true;
    }
  }, [canApplyProfile, refreshProfilesForToken]);

  const verifyProfileForToken = useCallback(async (
    token: ProfileOperationToken,
    writeConnectionError = true,
  ): Promise<PersistedServerProfile> => {
    const requestedProfile = api.getActiveProfile();
    if (!canApplyProfile(token, requestedProfile.id)) {
      throw new ProfileOperationSupersededError();
    }
    try {
      const verified = await api.verifyActiveProfile();
      if (!canApplyProfile(token, verified.id)) {
        throw new ProfileOperationSupersededError();
      }
      if (!await applyProfileSnapshot(verified, token)) {
        throw new ProfileOperationSupersededError();
      }
      return verified;
    } catch (reason) {
      const current = api.getActiveProfile();
      if (!canApplyProfile(token, current.id)) {
        throw new ProfileOperationSupersededError();
      }
      if (reason instanceof MobileContractError) {
        setCompatibility(compatibilityForContractError(reason, current));
      }
      if (writeConnectionError || !current.capabilities) {
        const message = reason instanceof MobileContractError
          ? reason.message
          : reason instanceof Error
            ? reason.message
            : 'BillManager could not verify this server.';
        setError(message);
      }
      throw reason;
    }
  }, [applyProfileSnapshot, canApplyProfile]);

  const verifyActiveProfile = useCallback(async () => {
    const current = api.getActiveProfile();
    const token = operationGuard.begin('verify', current.id);
    // Cancel an activation that is still awaiting candidate or credential I/O.
    api.beginProfileActivation();
    if (mountedRef.current) {
      setVerifying(true);
      setError(null);
    }
    try {
      return await verifyProfileForToken(token);
    } finally {
      if (mountedRef.current && operationGuard.isLatest(token)) {
        setVerifying(false);
      }
    }
  }, [operationGuard, verifyProfileForToken]);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    void (async () => {
      await api.initialize();
      if (cancelled || !mountedRef.current) return;
      const initial = api.getActiveProfile();
      const deferReadyUntilVerified = shouldDeferInitialReady(initial);
      const token = operationGuard.begin('initialize', initial.id);
      api.beginProfileActivation();
      await applyProfileSnapshot(initial, token);
      if (cancelled || !mountedRef.current || !operationGuard.isLatest(token)) return;
      if (!deferReadyUntilVerified) setLoading(false);

      try {
        setVerifying(true);
        await verifyProfileForToken(token, false);
      } catch {
        // verifyProfileForToken writes only guarded compatibility/error state.
        // A newer profile operation owns the UI when this token is stale.
      } finally {
        if (mountedRef.current && operationGuard.isLatest(token)) {
          setVerifying(false);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      operationGuard.cancel();
    };
  }, [applyProfileSnapshot, operationGuard, verifyProfileForToken]);

  const addProfile = useCallback(async ({ displayName, baseUrl }: { displayName?: string; baseUrl: string }) => {
    let token = operationGuard.begin('add', null);
    const activationRequestGeneration = api.beginProfileActivation();
    if (mountedRef.current) {
      setVerifying(true);
      setError(null);
    }
    try {
      const next = await profileForUrl(baseUrl, { allowInsecure: __DEV__ });
      if (displayName?.trim()) next.displayName = displayName.trim();
      const retargeted = operationGuard.retarget(token, next.id);
      if (!retargeted) throw new ProfileOperationSupersededError();
      token = retargeted;

      // Candidate verification is deliberately side-effect free. The active
      // profile, selected database, and tokens are unchanged if verification
      // fails at any point.
      const verified = await api.verifyProfileCandidate(next);
      if (!operationGuard.isLatest(token)) throw new ProfileOperationSupersededError();
      await api.switchProfile(verified, activationRequestGeneration);
      const activated = api.getActiveProfile();
      if (!canApplyProfile(token, activated.id)) {
        throw new ProfileOperationSupersededError();
      }
      if (!await applyProfileSnapshot(activated, token)) {
        throw new ProfileOperationSupersededError();
      }
      if (operationGuard.isLatest(token)) setError(null);
      return verified;
    } catch (reason) {
      if (mountedRef.current && operationGuard.isLatest(token)) {
        setError(reason instanceof Error ? reason.message : 'BillManager could not add this server.');
      }
      throw reason;
    } finally {
      if (mountedRef.current && operationGuard.isLatest(token)) {
        setVerifying(false);
      }
    }
  }, [applyProfileSnapshot, canApplyProfile, operationGuard]);

  const switchProfile = useCallback(async (profileId: string) => {
    const token = operationGuard.begin('switch', profileId);
    const activationRequestGeneration = api.beginProfileActivation();
    if (mountedRef.current) {
      setVerifying(true);
      setError(null);
    }
    try {
      const profile = await profileStore.getById(profileId);
      if (!profile) throw new Error('That server profile is no longer available.');
      if (!operationGuard.isLatest(token)) return;
      await api.switchProfile(
        { ...profile, isActive: true },
        activationRequestGeneration,
      );
      const activated = api.getActiveProfile();
      if (!canApplyProfile(token, activated.id)) return;
      if (!await applyProfileSnapshot(activated, token)) return;
      try {
        await verifyProfileForToken(token);
      } catch (reason) {
        if (reason instanceof ProfileOperationSupersededError) return;
        // Cached compatible capabilities allow offline launch. The guarded
        // visible error explains that live verification did not complete.
      }
    } catch (reason) {
      if (reason instanceof ProfileOperationSupersededError || !operationGuard.isLatest(token)) {
        return;
      }
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : 'BillManager could not switch servers.');
      }
      throw reason;
    } finally {
      if (mountedRef.current && operationGuard.isLatest(token)) {
        setVerifying(false);
      }
    }
  }, [applyProfileSnapshot, canApplyProfile, operationGuard, verifyProfileForToken]);

  const value = useMemo<ServerProfileContextValue>(() => ({
    profiles,
    activeProfile,
    loading,
    verifying,
    error,
    compatibility,
    addProfile,
    switchProfile,
    verifyActiveProfile,
    refreshProfiles,
  }), [
    activeProfile,
    addProfile,
    compatibility,
    error,
    loading,
    profiles,
    refreshProfiles,
    switchProfile,
    verifyActiveProfile,
    verifying,
  ]);

  if (loading) {
    return (
      <View
        style={styles.loading}
        accessibilityRole="progressbar"
        accessibilityLabel={t('mobileParity.profiles.preparingA11y')}
      >
        <ActivityIndicator color="#00875A" size="large" />
        <Text style={styles.loadingText}>{t('mobileParity.profiles.preparingWorkspace')}</Text>
      </View>
    );
  }

  return <ServerProfileContext.Provider value={value}>{children}</ServerProfileContext.Provider>;
}

export function useServerProfiles(): ServerProfileContextValue {
  const context = useContext(ServerProfileContext);
  if (!context) throw new Error('useServerProfiles must be used inside ServerProfileProvider');
  return context;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#F7FAF8',
  },
  loadingText: {
    color: '#4F6058',
    fontSize: 15,
  },
});
