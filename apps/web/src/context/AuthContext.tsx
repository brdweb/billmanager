import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import * as api from '../api/client';
import type { Database, TwoFARequiredResponse, LoginResponse } from '../api/client';
import { TokenStorage } from '../utils/tokenStorage';

interface AuthState {
  isLoggedIn: boolean;
  isAdmin: boolean;
  role: 'admin' | 'user' | null;
  databases: Database[];
  currentDb: string | null;
  isLoading: boolean;
  // For password change flow
  pendingPasswordChange: {
    userId: number;
    changeToken: string;
  } | null;
  // For 2FA flow
  pending2FA: {
    sessionToken: string;
    methods: string[];
  } | null;
}

interface LoginResult {
  success: boolean;
  warning?: string;
  requirePasswordChange?: boolean;
  require2FA?: boolean;
  twofa_session_token?: string;
  twofa_methods?: string[];
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<LoginResult>;
  loginWithOAuth: (provider: string, code: string, state: string) => Promise<LoginResult>;
  complete2FA: (method: string, payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  cancel2FA: () => void;
  logout: () => Promise<void>;
  selectDatabase: (dbName: string) => Promise<void>;
  completePasswordChange: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    isAdmin: false,
    role: null,
    databases: [],
    currentDb: null,
    isLoading: true,
    pendingPasswordChange: null,
    pending2FA: null,
  });

  const refreshAuth = useCallback(async () => {
    try {
      // Check if we have a valid access token
      const accessToken = TokenStorage.getAccessToken();
      if (!accessToken) {
        setState({
          isLoggedIn: false,
          isAdmin: false,
          role: null,
          databases: [],
          currentDb: null,
          isLoading: false,
          pendingPasswordChange: null,
          pending2FA: null,
        });
        return;
      }

      const response = await api.getMe();
      const currentDb = TokenStorage.getCurrentDatabase();

      setState({
        isLoggedIn: true,
        // Use is_account_owner from API (true for account owners who can access admin/billing)
        isAdmin: response.user.is_account_owner ?? response.user.role === 'admin',
        role: response.user.role,
        databases: response.databases,
        currentDb: currentDb || response.databases[0]?.name || null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });
    } catch {
      TokenStorage.clearTokens();
      setState({
        isLoggedIn: false,
        isAdmin: false,
        role: null,
        databases: [],
        currentDb: null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    try {
      const response = await api.loginWith2FA(username, password);

      // Check if 2FA is required
      if ('twofa_required' in response && response.twofa_required) {
        const twofaResp = response as TwoFARequiredResponse;
        setState((prev) => ({
          ...prev,
          pending2FA: {
            sessionToken: twofaResp.twofa_session_token,
            methods: twofaResp.twofa_methods,
          },
        }));
        return {
          success: true,
          require2FA: true,
          twofa_session_token: twofaResp.twofa_session_token,
          twofa_methods: twofaResp.twofa_methods,
        };
      }

      const loginResp = response as LoginResponse;

      if (loginResp.password_change_required) {
        setState((prev) => ({
          ...prev,
          pendingPasswordChange: {
            userId: loginResp.user_id!,
            changeToken: loginResp.change_token!,
          },
        }));
        return { success: true, requirePasswordChange: true };
      }

      // api.loginWith2FA already stored the tokens and set the first database
      const currentDb = TokenStorage.getCurrentDatabase();

      setState({
        isLoggedIn: true,
        isAdmin: loginResp.user.is_account_owner ?? loginResp.user.role === 'admin',
        role: loginResp.user.role,
        databases: loginResp.databases || [],
        currentDb: currentDb || loginResp.databases?.[0]?.name || null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });

      return { success: true, warning: loginResp.warning };
    } catch {
      return { success: false };
    }
  };

  const loginWithOAuth = async (provider: string, code: string, state: string): Promise<LoginResult> => {
    try {
      const response = await api.oauthCallback(provider, code, state);

      const currentDb = TokenStorage.getCurrentDatabase();

      setState({
        isLoggedIn: true,
        isAdmin: response.user.is_account_owner ?? response.user.role === 'admin',
        role: response.user.role,
        databases: response.databases || [],
        currentDb: currentDb || response.databases?.[0]?.name || null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });

      return { success: true };
    } catch (error: unknown) {
      // Check if 2FA is required (thrown as TwoFARequiredError)
      if (error instanceof api.TwoFARequiredError) {
        setState((prev) => ({
          ...prev,
          pending2FA: {
            sessionToken: error.response.twofa_session_token,
            methods: error.response.twofa_methods,
          },
        }));
        return {
          success: true,
          require2FA: true,
          twofa_session_token: error.response.twofa_session_token,
          twofa_methods: error.response.twofa_methods,
        };
      }
      return { success: false };
    }
  };

  const complete2FA = async (method: string, payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
    if (!state.pending2FA) {
      return { success: false, error: 'No pending 2FA session' };
    }

    try {
      const response = await api.verify2FA(state.pending2FA.sessionToken, method, payload);
      const currentDb = TokenStorage.getCurrentDatabase();

      setState({
        isLoggedIn: true,
        isAdmin: response.user.role === 'admin',
        role: response.user.role,
        databases: response.databases || [],
        currentDb: currentDb || response.databases?.[0]?.name || null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });

      return { success: true };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { success: false, error: err.message || 'Verification failed' };
    }
  };

  const cancel2FA = () => {
    setState((prev) => ({ ...prev, pending2FA: null }));
  };

  const completePasswordChange = async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!state.pendingPasswordChange) {
      return { success: false, error: 'No pending password change' };
    }

    try {
      await api.changePassword(
        state.pendingPasswordChange.userId,
        state.pendingPasswordChange.changeToken,
        currentPassword,
        newPassword
      );

      // Refresh auth state after password change
      await refreshAuth();
      return { success: true };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      return {
        success: false,
        error: err.response?.data?.error || 'Failed to change password',
      };
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setState({
        isLoggedIn: false,
        isAdmin: false,
        role: null,
        databases: [],
        currentDb: null,
        isLoading: false,
        pendingPasswordChange: null,
        pending2FA: null,
      });
    }
  };

  const selectDatabase = async (dbName: string) => {
    try {
      // Database selection is now client-side only via TokenStorage
      // No API call needed - just update localStorage and state
      TokenStorage.setCurrentDatabase(dbName);
      setState((prev) => ({ ...prev, currentDb: dbName }));
    } catch (error) {
      console.error('Failed to select database:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginWithOAuth,
        complete2FA,
        cancel2FA,
        logout,
        selectDatabase,
        completePasswordChange,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
