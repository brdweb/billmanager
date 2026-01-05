import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api/client';
import { User, DatabaseInfo } from '../types';

const SERVER_TYPE_KEY = 'billmanager_server_type';

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
  isSelfHosted: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    user: null,
    databases: [],
    currentDatabase: null,
    serverType: 'cloud',
  });

  // Initialize on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  const loadServerType = async (): Promise<ServerType> => {
    try {
      const savedType = await SecureStore.getItemAsync(SERVER_TYPE_KEY) as ServerType | null;
      return savedType || 'cloud';
    } catch {
      return 'cloud';
    }
  };

  const initializeAuth = async () => {
    try {
      const [hasToken, serverType] = await Promise.all([
        api.initialize(),
        loadServerType(),
      ]);

      console.log('[AuthContext] initializeAuth - hasToken:', hasToken, 'serverType:', serverType);

      if (hasToken) {
        // Verify token is still valid by fetching user info
        const response = await api.getUserInfo();
        console.log('[AuthContext] initializeAuth - getUserInfo response:', JSON.stringify(response, null, 2));

        let userData: User | null = null;
        let databases: DatabaseInfo[] = [];
        let currentDb: string | null = null;

        if (response.success && response.data) {
          // Check for nested user object (New Server)
          if (response.data.user) {
             userData = {
              id: response.data.user.id,
              username: response.data.user.username,
              email: response.data.user.email,
              role: response.data.user.role,
              is_account_owner: response.data.user.is_account_owner,
            };
            databases = response.data.databases || [];
            currentDb = api.getCurrentDatabase();
          } 
          // Check for flat user properties (Legacy/Cloud Server)
          else if ((response.data as any).username) {
             const data = response.data as any;
             userData = {
              id: data.id,
              username: data.username,
              email: data.email,
              role: data.role,
              is_account_owner: data.is_account_owner,
            };
            databases = data.databases || [];
            currentDb = data.current_db || api.getCurrentDatabase();
          }
        }

        if (userData) {
          console.log('[AuthContext] initializeAuth - Setting user:', userData);
          setState({
            isLoading: false,
            isAuthenticated: true,
            user: userData,
            databases: databases,
            currentDatabase: currentDb,
            serverType,
          });
          return;
        } else {
          console.log('[AuthContext] initializeAuth - No user in response, clearing auth');
        }
      }

      setState({
        isLoading: false,
        isAuthenticated: false,
        user: null,
        databases: [],
        currentDatabase: null,
        serverType,
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      const serverType = await loadServerType();
      setState({
        isLoading: false,
        isAuthenticated: false,
        user: null,
        databases: [],
        currentDatabase: null,
        serverType,
      });
    }
  };

  // Set up auth error handler to trigger logout
  useEffect(() => {
    api.setAuthErrorHandler(() => {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isAuthenticated: false,
        user: null,
        databases: [],
        currentDatabase: null,
      }));
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      // First, login to get tokens
      const loginResponse = await api.login(username, password);
      console.log('[AuthContext] Login response:', JSON.stringify(loginResponse, null, 2));

      if (!loginResponse.success) {
        return { success: false, error: loginResponse.error || 'Login failed' };
      }

      // The login response includes user info, use it directly
      const serverType = await loadServerType();

      // Fetch user info from /me endpoint after login
      console.log('[AuthContext] Fetching user info from /me');
      const userInfoResponse = await api.getUserInfo();
      console.log('[AuthContext] getUserInfo response:', JSON.stringify(userInfoResponse, null, 2));

      let userData: User | null = null;
      let databases: DatabaseInfo[] = [];
      let currentDb: string | null = null;

      if (userInfoResponse.success && userInfoResponse.data) {
          if (userInfoResponse.data.user) {
            userData = {
              id: userInfoResponse.data.user.id,
              username: userInfoResponse.data.user.username,
              email: userInfoResponse.data.user.email,
              role: userInfoResponse.data.user.role,
              is_account_owner: userInfoResponse.data.user.is_account_owner,
            };
            databases = userInfoResponse.data.databases || [];
            currentDb = userInfoResponse.data.databases?.[0]?.name || null;
          } else if ((userInfoResponse.data as any).username) {
            const data = userInfoResponse.data as any;
            userData = {
              id: data.id,
              username: data.username,
              email: data.email,
              role: data.role,
              is_account_owner: data.is_account_owner,
            };
            databases = data.databases || [];
            currentDb = data.current_db || data.databases?.[0]?.name || null;
          }
      }

      if (userData) {
        setState({
          isLoading: false,
          isAuthenticated: true,
          user: userData,
          databases: databases,
          currentDatabase: currentDb,
          serverType,
        });
        return { success: true };
      }

      console.error('[AuthContext] Failed to get user info from /me');
      return { success: false, error: 'Failed to get user info' };
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      return { success: false, error: 'An unexpected error occurred' };
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState(prev => ({
      ...prev,
      isLoading: false,
      isAuthenticated: false,
      user: null,
      databases: [],
      currentDatabase: null,
    }));
  }, []);

  const refreshUserInfo = useCallback(async () => {
    const response = await api.getUserInfo();
    let userData: User | null = null;
    let databases: DatabaseInfo[] = [];

    if (response.success && response.data) {
        if (response.data.user) {
            userData = {
                id: response.data.user.id,
                username: response.data.user.username,
                email: response.data.user.email,
                role: response.data.user.role,
                is_account_owner: response.data.user.is_account_owner,
            };
            databases = response.data.databases || [];
        } else if ((response.data as any).username) {
            const data = response.data as any;
            userData = {
                id: data.id,
                username: data.username,
                email: data.email,
                role: data.role,
                is_account_owner: data.is_account_owner,
            };
            databases = data.databases || [];
        }
    }

    if (userData) {
      setState(prev => ({
        ...prev,
        user: userData,
        databases: databases,
      }));
    }
  }, []);

  const selectDatabase = useCallback(async (dbName: string) => {
    await api.setCurrentDatabase(dbName);
    setState(prev => ({ ...prev, currentDatabase: dbName }));
  }, []);

  const refreshDatabases = useCallback(async () => {
    const response = await api.getAccounts();
    if (response.success && response.data) {
      setState(prev => ({ ...prev, databases: response.data! }));
    }
  }, []);

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
