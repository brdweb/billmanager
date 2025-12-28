import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import * as api from '../api/client';
import type { Database } from '../api/client';

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
}

interface LoginResult {
  success: boolean;
  warning?: string;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<LoginResult>;
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
  });

  const refreshAuth = useCallback(async () => {
    try {
      const response = await api.getMe();
      setState({
        isLoggedIn: true,
        // Use is_account_owner from API (true for account owners who can access admin/billing)
        isAdmin: response.is_account_owner ?? response.role === 'admin',
        role: response.role,
        databases: response.databases,
        currentDb: response.current_db,
        isLoading: false,
        pendingPasswordChange: null,
      });
    } catch {
      setState({
        isLoggedIn: false,
        isAdmin: false,
        role: null,
        databases: [],
        currentDb: null,
        isLoading: false,
        pendingPasswordChange: null,
      });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    try {
      const response = await api.login(username, password);

      if (response.password_change_required) {
        setState((prev) => ({
          ...prev,
          pendingPasswordChange: {
            userId: response.user_id!,
            changeToken: response.change_token!,
          },
        }));
        return { success: true }; // Login succeeded but password change required
      }

      setState({
        isLoggedIn: true,
        // Use is_account_owner from API (true for account owners who can access admin/billing)
        isAdmin: response.is_account_owner ?? response.role === 'admin',
        role: response.role,
        databases: response.databases || [],
        currentDb: response.databases?.[0]?.name || null,
        isLoading: false,
        pendingPasswordChange: null,
      });

      // Return warning if user has no database access
      return { success: true, warning: response.warning };
    } catch {
      return { success: false };
    }
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
      });
    }
  };

  const selectDatabase = async (dbName: string) => {
    try {
      await api.selectDatabase(dbName);
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
