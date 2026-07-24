import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { api } from '../api/client';
import { SQLiteAuthSessionStore } from '../data/authSessionRepository';
import {
  authenticatedSessionFromPayload,
  canUseCachedSession,
  type AuthenticatedSessionSnapshot,
} from '../services/authSession';
import type { AuthFlowResult, AuthSessionScope } from '../features/auth';
import type { DatabaseInfo, User } from '../types';
import i18n from '../i18n';
import { configureFormatting } from '../i18n/format';
import {
  AuthOperationGuard,
  SerializedAuthSessionWrites,
  type AuthOperationToken,
  type DatabaseOperationToken,
} from './authOperationGuard';

type ServerType = 'cloud' | 'self-hosted' | 'local-dev';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  databases: DatabaseInfo[];
  currentDatabase: string | null;
  serverType: ServerType;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  selectDatabase: (dbName: string) => Promise<void>;
  refreshDatabases: () => Promise<void>;
  refreshUserInfo: () => Promise<void>;
  adoptAuthenticatedSession: (
    result: Extract<AuthFlowResult, { status: 'authenticated' }>,
  ) => Promise<{ success: boolean; error?: string }>;
  finalizeAccountDeletion: (scope: AuthSessionScope) => Promise<void>;
  isSelfHosted: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const authSessionStore = new SQLiteAuthSessionStore();

function serverTypeForActiveProfile(): ServerType {
  switch (api.getActiveProfile().deploymentMode) {
    case 'self_hosted':
      return 'self-hosted';
    case 'development':
      return 'local-dev';
    default:
      return 'cloud';
  }
}

function anonymousState(serverType = serverTypeForActiveProfile()): AuthState {
  return {
    isLoading: false,
    isAuthenticated: false,
    user: null,
    databases: [],
    currentDatabase: null,
    serverType,
  };
}

function authenticatedState(
  snapshot: AuthenticatedSessionSnapshot,
  serverType = serverTypeForActiveProfile(),
): AuthState {
  const capabilities = api.getActiveProfile().capabilities;
  configureFormatting(
    capabilities?.defaultLocale,
    snapshot.user.currency ?? capabilities?.defaultCurrency,
    i18n.resolvedLanguage ?? i18n.language,
  );
  return {
    isLoading: false,
    isAuthenticated: true,
    user: snapshot.user,
    databases: snapshot.databases,
    currentDatabase: snapshot.currentDatabase,
    serverType,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ...anonymousState(),
    isLoading: true,
  });
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const providerProfileIdRef = useRef(api.getActiveProfile().id);
  const operationGuardRef = useRef(new AuthOperationGuard());
  const sessionWritesRef = useRef(new SerializedAuthSessionWrites());

  const replaceState = useCallback((next: AuthState) => {
    if (!mountedRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const updateState = useCallback((update: (previous: AuthState) => AuthState) => {
    if (!mountedRef.current) return;
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const isAuthCurrent = useCallback((token: AuthOperationToken) => (
    mountedRef.current
    && token.profileId === providerProfileIdRef.current
    && operationGuardRef.current.isAuthCurrent(token, api.getActiveProfile().id)
  ), []);

  const isDatabaseCurrent = useCallback((token: DatabaseOperationToken) => (
    mountedRef.current
    && operationGuardRef.current.isDatabaseCurrent(token, api.captureAuthSessionScope())
  ), []);

  const serializeSessionWrite = useCallback(<T,>(operation: () => Promise<T>) => (
    sessionWritesRef.current.run(operation)
  ), []);

  const prepareSnapshot = useCallback(async (
    token: AuthOperationToken,
    snapshot: AuthenticatedSessionSnapshot,
  ): Promise<AuthenticatedSessionSnapshot | null> => {
    if (!isAuthCurrent(token)) return null;
    if (!api.getCurrentDatabase() && snapshot.currentDatabase) {
      const selection = operationGuardRef.current.beginDatabaseSelection(
        token.profileId,
        snapshot.currentDatabase,
      );
      await api.setCurrentDatabase(snapshot.currentDatabase, {
        serverProfileId: token.profileId,
        databaseId: null,
      });
      if (!isDatabaseCurrent(selection)) return null;
    }
    if (!isAuthCurrent(token)) return null;
    return {
      ...snapshot,
      currentDatabase: api.getCurrentDatabase(),
    };
  }, [isAuthCurrent, isDatabaseCurrent]);

  const saveSnapshot = useCallback(async (
    token: AuthOperationToken,
    snapshot: AuthenticatedSessionSnapshot,
  ): Promise<boolean> => serializeSessionWrite(async () => {
    if (!isAuthCurrent(token)) return false;
    await authSessionStore.save(token.profileId, snapshot);
    return isAuthCurrent(token);
  }), [isAuthCurrent, serializeSessionWrite]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    void (async () => {
      const serverType = serverTypeForActiveProfile();
      const profileId = api.getActiveProfile().id;
      const authOperation = operationGuardRef.current.captureAuth(profileId);
      try {
        // ServerProfileProvider owns API initialization and profile activation.
        // Re-initializing here can race a live /config verification and make a
        // same-profile response look stale. The keyed provider is mounted only
        // after the active profile and its credentials have been applied.
        const hasToken = api.hasActiveAccessToken();
        if (!hasToken) {
          if (isAuthCurrent(authOperation)) replaceState(anonymousState(serverType));
          return;
        }

        const sessionScope = {
          serverProfileId: profileId,
          databaseId: api.getCurrentDatabase(),
        };
        const cachedPromise = authSessionStore.get(profileId).catch(() => null);
        const response = await api.getUserInfo(sessionScope);
        if (response.success && response.data) {
          const live = authenticatedSessionFromPayload(
            response.data,
            sessionScope.databaseId,
          );
          if (live) {
            const prepared = await prepareSnapshot(authOperation, live);
            if (
              prepared
              && await saveSnapshot(authOperation, prepared)
              && isAuthCurrent(authOperation)
            ) {
              replaceState(authenticatedState(prepared, serverType));
            }
            return;
          }
        }

        const cached = await cachedPromise;
        if (cached && canUseCachedSession(hasToken, response.httpStatus)) {
          const prepared = await prepareSnapshot(authOperation, cached);
          if (
            prepared
            && await saveSnapshot(authOperation, prepared)
            && isAuthCurrent(authOperation)
          ) {
            replaceState(authenticatedState(prepared, serverType));
          }
          return;
        }

        if (response.httpStatus === 401 || response.httpStatus === 403) {
          operationGuardRef.current.invalidateAuthentication(profileId);
          replaceState(anonymousState(serverType));
          const clearSnapshot = serializeSessionWrite(() => (
            authSessionStore.clear(profileId).catch(() => undefined)
          ));
          await Promise.all([api.logout(sessionScope), clearSnapshot]);
          return;
        }
        if (isAuthCurrent(authOperation)) replaceState(anonymousState(serverType));
      } catch (error) {
        if (__DEV__) console.error('Auth initialization error:', error);
        if (isAuthCurrent(authOperation)) replaceState(anonymousState(serverType));
      }
    })();
  }, [
    isAuthCurrent,
    prepareSnapshot,
    replaceState,
    saveSnapshot,
    serializeSessionWrite,
  ]);

  useEffect(() => {
    api.setAuthErrorHandler(() => {
      if (!mountedRef.current) return;
      const profileId = providerProfileIdRef.current;
      if (api.getActiveProfile().id !== profileId) return;
      operationGuardRef.current.invalidateAuthentication(profileId);
      replaceState(anonymousState());
      void serializeSessionWrite(() => (
        authSessionStore.clear(profileId).catch(() => undefined)
      ));
    });
    return () => api.setAuthErrorHandler(null);
  }, [replaceState, serializeSessionWrite]);

  const login = useCallback(async (username: string, password: string) => {
    const profileId = api.getActiveProfile().id;
    const authOperation = operationGuardRef.current.captureAuth(profileId);
    try {
      const loginResponse = await api.login(username, password);
      if (!loginResponse.success || !loginResponse.data) {
        return { success: false, error: loginResponse.error || 'Login failed' };
      }

      const scope = loginResponse.scope;
      if (!scope) return { success: false, error: 'Login scope was not returned.' };
      const snapshot = authenticatedSessionFromPayload(
        loginResponse.data,
        scope.databaseId,
      );
      if (!snapshot) return { success: false, error: 'Failed to get user info' };

      if (!isAuthCurrent(authOperation) || scope.serverProfileId !== profileId) {
        return { success: false, error: 'The server changed while sign-in was completing.' };
      }
      const prepared = await prepareSnapshot(authOperation, snapshot);
      if (!prepared || !await saveSnapshot(authOperation, prepared)) {
        return { success: false, error: 'Sign-in was cancelled before it completed.' };
      }
      if (!isAuthCurrent(authOperation)) {
        return { success: false, error: 'Sign-in was cancelled before it completed.' };
      }
      replaceState(authenticatedState(prepared));
      return { success: true };
    } catch (error) {
      if (__DEV__) console.error('[AuthContext] Login error:', error);
      return { success: false, error: 'An unexpected error occurred' };
    }
  }, [isAuthCurrent, prepareSnapshot, replaceState, saveSnapshot]);

  const logout = useCallback(async () => {
    const scope = api.captureAuthSessionScope();
    operationGuardRef.current.invalidateAuthentication(scope.serverProfileId);
    replaceState(anonymousState());
    const clearSnapshot = serializeSessionWrite(() => (
      authSessionStore.clear(scope.serverProfileId).catch(() => undefined)
    ));
    await Promise.all([api.logout(scope), clearSnapshot]);
  }, [replaceState, serializeSessionWrite]);

  const finalizeAccountDeletion = useCallback(async (scope: AuthSessionScope) => {
    operationGuardRef.current.invalidateAuthentication(scope.serverProfileId);
    if (api.getActiveProfile().id === scope.serverProfileId) {
      replaceState(anonymousState());
    }
    await serializeSessionWrite(() => (
      authSessionStore.clear(scope.serverProfileId).catch(() => undefined)
    ));
  }, [replaceState, serializeSessionWrite]);

  const refreshUserInfo = useCallback(async () => {
    const scope = api.captureAuthSessionScope();
    const authOperation = operationGuardRef.current.captureAuth(scope.serverProfileId);
    const databaseOperation = operationGuardRef.current.captureDatabase(scope);
    const response = await api.getUserInfo(scope);
    if (!response.success || !response.data || !isAuthCurrent(authOperation)) return;
    const snapshot = authenticatedSessionFromPayload(
      response.data,
      api.getCurrentDatabase(),
    );
    if (!snapshot) return;
    const persisted = await serializeSessionWrite(async () => {
      if (!isAuthCurrent(authOperation)) return false;
      if (!isDatabaseCurrent(databaseOperation)) return true;
      await authSessionStore.save(scope.serverProfileId, {
        ...snapshot,
        currentDatabase: api.getCurrentDatabase(),
        updatedAt: new Date().toISOString(),
      });
      return isAuthCurrent(authOperation) && isDatabaseCurrent(databaseOperation);
    });
    if (!persisted || !isAuthCurrent(authOperation)) return;
    const capabilities = api.getActiveProfile().capabilities;
    configureFormatting(
      capabilities?.defaultLocale,
      snapshot.user.currency ?? capabilities?.defaultCurrency,
      i18n.resolvedLanguage ?? i18n.language,
    );
    const selectionUnchanged = isDatabaseCurrent(databaseOperation);
    updateState((previous) => ({
      ...previous,
      isLoading: false,
      isAuthenticated: true,
      user: snapshot.user,
      databases: snapshot.databases,
      currentDatabase: selectionUnchanged
        ? api.getCurrentDatabase()
        : previous.currentDatabase,
    }));
  }, [isAuthCurrent, isDatabaseCurrent, serializeSessionWrite, updateState]);

  const selectDatabase = useCallback(async (dbName: string) => {
    const scope = api.captureAuthSessionScope();
    const selection = operationGuardRef.current.beginDatabaseSelection(
      scope.serverProfileId,
      dbName,
    );
    await api.setCurrentDatabase(dbName, scope);
    if (!isDatabaseCurrent(selection)) return;
    const persisted = await serializeSessionWrite(async () => {
      if (!isDatabaseCurrent(selection)) return false;
      await authSessionStore
        .setCurrentDatabase(scope.serverProfileId, dbName)
        .catch(() => undefined);
      return isDatabaseCurrent(selection);
    });
    if (!persisted || !isDatabaseCurrent(selection)) return;
    updateState((previous) => ({ ...previous, currentDatabase: dbName }));
  }, [isDatabaseCurrent, serializeSessionWrite, updateState]);

  const refreshDatabases = useCallback(async () => {
    const scope = api.captureAuthSessionScope();
    const authOperation = operationGuardRef.current.captureAuth(scope.serverProfileId);
    const databaseOperation = operationGuardRef.current.captureDatabase(scope);
    const response = await api.getAccounts(scope);
    if (!response.success || !response.data || !isAuthCurrent(authOperation)) return;
    const databases = response.data;
    await serializeSessionWrite(async () => {
      if (!isAuthCurrent(authOperation)) return;
      if (!isDatabaseCurrent(databaseOperation)) return;
      const current = stateRef.current;
      if (!current.user) return;
      await authSessionStore.save(scope.serverProfileId, {
        user: current.user,
        databases,
        currentDatabase: api.getCurrentDatabase(),
        updatedAt: new Date().toISOString(),
      });
    });
    if (!isAuthCurrent(authOperation)) return;
    updateState((previous) => ({ ...previous, databases }));
  }, [isAuthCurrent, isDatabaseCurrent, serializeSessionWrite, updateState]);

  const adoptAuthenticatedSession = useCallback(async (
    result: Extract<AuthFlowResult, { status: 'authenticated' }>,
  ) => {
    const profileId = api.getActiveProfile().id;
    const authOperation = operationGuardRef.current.captureAuth(profileId);
    const snapshot = authenticatedSessionFromPayload(
      result.session,
      result.scope.databaseId,
    );
    if (!snapshot) {
      return { success: false, error: 'The server did not return an authenticated user.' };
    }
    if (!isAuthCurrent(authOperation) || result.scope.serverProfileId !== profileId) {
      return {
        success: false,
        error: 'The server changed while sign-in was completing.',
      };
    }
    const prepared = await prepareSnapshot(authOperation, snapshot);
    if (!prepared || !await saveSnapshot(authOperation, prepared)) {
      return { success: false, error: 'Sign-in was cancelled before it completed.' };
    }
    if (!isAuthCurrent(authOperation)) {
      return { success: false, error: 'Sign-in was cancelled before it completed.' };
    }
    replaceState(authenticatedState(prepared));
    return { success: true };
  }, [isAuthCurrent, prepareSnapshot, replaceState, saveSnapshot]);

  const isSelfHosted = state.serverType === 'self-hosted' || state.serverType === 'local-dev';

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        selectDatabase,
        refreshDatabases,
        refreshUserInfo,
        adoptAuthenticatedSession,
        finalizeAccountDeletion,
        isSelfHosted,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
