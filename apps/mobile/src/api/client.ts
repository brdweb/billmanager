import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { ApiResponse, LoginResponse, Bill, Payment, SyncResponse, SyncPushRequest, SyncPushResponse, DeviceInfo, MonthlyStats, DatabaseInfo, AdminUser, Invitation, DatabaseWithAccess, User, SubscriptionStatus, BillingUsage, BillShare, SharedBill, PendingShare, UserSearchResult, SettlementsResponse } from '../types';
import {
  PersistedServerProfile,
  ServerProfileStore,
  defaultCloudProfile,
} from '../domain/serverProfile';
import { SQLiteServerProfileStore } from '../data/profileRepository';
import { SQLiteSyncRepository } from '../data/syncRepository';
import { migrateLegacyProfile } from '../services/legacyProfileMigration';
import { migrateProfileIdentities } from '../services/profileIdentityMigration';
import {
  OAuthScopeStore,
  SecureOAuthScopeStore,
} from '../services/oauthScopeStore';
import {
  LegacySecureStore,
  ProfileTokenStore,
  SecureProfileTokenStore,
} from './tokenStore';
import { normalizeServerUrl, profileForUrl, ServerUrlError } from './serverUrl';
import { parseServerCapabilities } from './capabilities';
import type {
  AuthSessionScope,
  AuthFlowResult,
  MessageResult,
  OAuthAccount,
  OAuthAuthorization,
  OAuthCallbackParameters,
  OAuthProvider,
  RegistrationResult,
  ShareInviteAcceptance,
  ShareInviteInfo,
  TeamInviteAcceptance,
  TeamInviteInfo,
  TwoFactorMethod,
} from '../features/auth/types';
import type {
  EmailTwoFactorSetup,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResult,
  PasskeySummary,
  RecoveryCodesResult,
  TwoFactorConfirmation,
  TwoFactorStatus,
} from '../features/security/types';

export interface BillManagerApiOptions {
  profile?: PersistedServerProfile;
  profileStore?: ServerProfileStore;
  tokenStore?: ProfileTokenStore;
  legacyStorage?: LegacySecureStore;
  syncRepository?: SQLiteSyncRepository;
  oauthScopeStore?: OAuthScopeStore;
  allowInsecure?: boolean;
}

export interface MutationMetadata {
  clientMutationId: string;
  baseUpdatedAt: string | null;
}

export interface MutationScope {
  serverProfileId: string;
  databaseId: string;
}

export interface ScopedLoginResponse extends ApiResponse<LoginResponse> {
  scope?: AuthSessionScope;
}

export interface ScopedMessageResponse extends ApiResponse<MessageResult> {
  scope: AuthSessionScope;
}

interface AuthenticationRequestBinding {
  profile: PersistedServerProfile;
  scope: AuthSessionScope;
  accessToken: string | null;
  refreshToken: string | null;
  sessionGeneration: number;
}

// A foreground API singleton and a headless API instance can coexist in one
// JavaScript runtime. Keep session generations and mutation queues at module
// scope so logout/account deletion invalidates token work from either instance.
const profileSessionGenerations = new Map<string, number>();
const profileSessionMutationTails = new Map<string, Promise<void>>();

function sessionGeneration(profileId: string): number {
  return profileSessionGenerations.get(profileId) ?? 0;
}

function invalidateSessionGeneration(profileId: string): number {
  const next = sessionGeneration(profileId) + 1;
  profileSessionGenerations.set(profileId, next);
  return next;
}

async function serializeProfileSessionMutation<T>(
  profileId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = profileSessionMutationTails.get(profileId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(mutation);
  const tail = result.then(() => undefined, () => undefined);
  profileSessionMutationTails.set(profileId, tail);
  try {
    return await result;
  } finally {
    if (profileSessionMutationTails.get(profileId) === tail) {
      profileSessionMutationTails.delete(profileId);
    }
  }
}

class AuthSessionSupersededError extends Error {
  constructor() {
    super('The authentication session was superseded.');
    this.name = 'AuthSessionSupersededError';
  }
}

export class ProfileVerificationSupersededError extends Error {
  constructor() {
    super('The active server changed while verification was completing.');
    this.name = 'ProfileVerificationSupersededError';
  }
}

export class ProfileActivationSupersededError extends Error {
  constructor() {
    super('A newer server profile activation superseded this request.');
    this.name = 'ProfileActivationSupersededError';
  }
}

export class BillManagerApi {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private currentDatabase: string | null = null;
  private onAuthError: (() => void) | null = null;
  private activeProfile: PersistedServerProfile;
  private configurationError: ServerUrlError | null = null;
  private readonly profileStore: ServerProfileStore;
  private readonly tokenStore: ProfileTokenStore;
  private readonly legacyStorage: LegacySecureStore;
  private readonly syncRepository: SQLiteSyncRepository;
  private readonly oauthScopeStore: OAuthScopeStore;
  private readonly allowInsecure: boolean;
  private profileActivationGeneration = 0;
  private profileActivationRequestGeneration = 0;
  private readonly databaseSelectionRequestGenerations = new Map<string, number>();
  private profileMutationTail: Promise<void> = Promise.resolve();

  constructor(options: BillManagerApiOptions = {}) {
    this.allowInsecure = options.allowInsecure
      ?? ((globalThis as { __DEV__?: boolean }).__DEV__ ?? false);
    this.profileStore = options.profileStore ?? new SQLiteServerProfileStore();
    this.tokenStore = options.tokenStore ?? new SecureProfileTokenStore();
    this.legacyStorage = options.legacyStorage ?? SecureStore;
    this.syncRepository = options.syncRepository ?? new SQLiteSyncRepository();
    this.oauthScopeStore = options.oauthScopeStore ?? new SecureOAuthScopeStore();
    this.activeProfile = options.profile ?? defaultCloudProfile();
    this.currentDatabase = this.activeProfile.selectedDatabase;
    this.validateActiveProfile();

    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor - add auth headers
    this.client.interceptors.request.use(
      (config) => {
        // Bind every request to a profile/database snapshot. Never rely on a
        // mutable Axios base URL: a profile switch must not be able to redirect
        // an in-flight request or its refresh retry to another deployment.
        const authBinding = (config as typeof config & {
          _authenticationBinding?: AuthenticationRequestBinding;
        })._authenticationBinding;
        if (this.configurationError && !authBinding) {
          return Promise.reject(this.configurationError);
        }
        const profile = authBinding?.profile ?? { ...this.activeProfile };
        const accessToken = authBinding ? authBinding.accessToken : this.accessToken;
        const refreshToken = authBinding ? authBinding.refreshToken : this.refreshToken;
        const databaseId = authBinding ? authBinding.scope.databaseId : this.currentDatabase;
        const requestSessionGeneration = authBinding?.sessionGeneration
          ?? sessionGeneration(profile.id);
        config.baseURL = normalizeServerUrl(profile.baseUrl, {
          allowInsecure: this.allowInsecure,
        });
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }
        if (databaseId) {
          config.headers['X-Database'] = databaseId;
        }
        Object.assign(config, {
          _serverProfileId: profile.id,
          _databaseId: databaseId,
          _refreshToken: refreshToken,
          _sessionGeneration: requestSessionGeneration,
        });
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // If 401 and we haven't tried refreshing yet
        const requestProfileId = originalRequest?._serverProfileId as string | undefined;
        const requestRefreshToken = originalRequest?._refreshToken as string | null | undefined;
        const requestSessionGeneration = originalRequest?._sessionGeneration as number | undefined;
        if (
          error.response?.status === 401
          && !originalRequest?._retry
          && requestProfileId
          && requestRefreshToken
        ) {
          originalRequest._retry = true;

          try {
            const profile = await this.profileStore.getById(requestProfileId);
            if (!profile) throw new Error('The request profile no longer exists');
            const baseURL = normalizeServerUrl(profile.baseUrl, {
              allowInsecure: this.allowInsecure,
            });
            const refreshResponse = await axios.post<ApiResponse<{
              access_token: string;
              refresh_token?: string;
            }>>(`${baseURL}/auth/refresh`, { refresh_token: requestRefreshToken });
            const session = refreshResponse.data.data;
            if (!refreshResponse.data.success || !session?.access_token) {
              throw new Error('Token refresh failed');
            }

            const refreshedTokens = {
              accessToken: session.access_token,
              refreshToken: session.refresh_token ?? requestRefreshToken,
            };
            const installed = await this.installRotatedTokens(
              profile,
              refreshedTokens,
              requestSessionGeneration ?? sessionGeneration(requestProfileId),
            );
            if (!installed) return Promise.reject(error);
            originalRequest.baseURL = baseURL;
            originalRequest.headers.Authorization = `Bearer ${refreshedTokens.accessToken}`;
            originalRequest._refreshToken = refreshedTokens.refreshToken;
            originalRequest._sessionGeneration = sessionGeneration(requestProfileId);
            return axios.request(originalRequest);
          } catch {
            const cleared = await this.invalidateAndClearTokensIfCurrent(
              requestProfileId,
              requestSessionGeneration ?? sessionGeneration(requestProfileId),
            );
            if (cleared && this.activeProfile.id === requestProfileId) {
              this.onAuthError?.();
            }
          }
        }

        return Promise.reject(error);
      }
    );
  }

  // Initialize from stored tokens
  async initialize(): Promise<boolean> {
    const activationRequestGeneration = this.beginProfileActivation();
    try {
      const migration = await migrateLegacyProfile(
        this.profileStore,
        this.tokenStore,
        this.legacyStorage,
      );
      await migrateProfileIdentities(this.profileStore, this.tokenStore);
      return this.serializeProfileMutation(async () => {
        if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
          throw new ProfileActivationSupersededError();
        }
        // Re-read inside the activation queue. A profile switch may have
        // committed while storage migrations were awaiting native I/O.
        const activeProfile = await this.profileStore.getActive() ?? migration.profile;
        const tokens = await this.tokenStore.load(activeProfile.id);
        if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
          throw new ProfileActivationSupersededError();
        }
        this.profileActivationGeneration += 1;
        this.applyProfile(activeProfile);
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
        return !!this.accessToken;
      });
    } catch {
      return false;
    }
  }

  // Set callback for auth errors (triggers logout in app)
  setAuthErrorHandler(handler: (() => void) | null) {
    this.onAuthError = handler;
  }

  // Get current base URL (for debugging)
  getBaseUrl(): string {
    return this.activeProfile.baseUrl;
  }

  getActiveProfile(): PersistedServerProfile {
    return { ...this.activeProfile };
  }

  hasActiveAccessToken(): boolean {
    return Boolean(this.accessToken);
  }

  /**
   * Reserves the next profile activation before asynchronous candidate work
   * begins. Passing the returned generation to switchProfile prevents an
   * older candidate or slow credential read from activating after a newer
   * profile choice.
   */
  beginProfileActivation(): number {
    this.profileActivationRequestGeneration += 1;
    return this.profileActivationRequestGeneration;
  }

  captureAuthSessionScope(): AuthSessionScope {
    return {
      serverProfileId: this.activeProfile.id,
      databaseId: this.currentDatabase,
    };
  }

  private async authenticationBinding(
    scope?: AuthSessionScope,
  ): Promise<AuthenticationRequestBinding> {
    const profileId = scope?.serverProfileId ?? this.activeProfile.id;
    const capturedGeneration = sessionGeneration(profileId);
    if (!scope || profileId === this.activeProfile.id) {
      return {
        profile: { ...this.activeProfile },
        scope: scope ?? this.captureAuthSessionScope(),
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        sessionGeneration: capturedGeneration,
      };
    }

    const profile = await this.profileStore.getById(scope.serverProfileId);
    if (!profile) {
      throw new Error(`Unknown server profile for authentication: ${scope.serverProfileId}`);
    }
    const tokens = await this.tokenStore.load(scope.serverProfileId);
    return {
      profile,
      scope,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionGeneration: capturedGeneration,
    };
  }

  private authenticationRequestConfig(binding: AuthenticationRequestBinding): any {
    return { _authenticationBinding: binding };
  }

  /**
   * Compatibility adapter for the alpha login UI. New UI should construct a
   * ServerProfile and call switchProfile so persistence and token loading are
   * awaited explicitly.
   */
  async setBaseUrl(url: string): Promise<void> {
    const activationRequestGeneration = this.beginProfileActivation();
    let profile: PersistedServerProfile;
    let configurationError: ServerUrlError | null = null;
    try {
      profile = await profileForUrl(url, { allowInsecure: this.allowInsecure });
    } catch (error) {
      if (!(error instanceof ServerUrlError)) throw error;
      configurationError = error;
      // Retain the entered profile for a useful error and server isolation, but
      // the request interceptor prevents release traffic to it.
      profile = await profileForUrl(url, { allowInsecure: true });
    }

    await this.serializeProfileMutation(async () => {
      if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
        throw new ProfileActivationSupersededError();
      }
      if (profile.id !== this.activeProfile.id) {
        this.accessToken = null;
        this.refreshToken = null;
        this.currentDatabase = null;
      }
      this.profileActivationGeneration += 1;
      this.configurationError = configurationError;
      this.applyProfile(profile);
    });
  }

  async switchProfile(
    profile: PersistedServerProfile,
    activationRequestGeneration = this.beginProfileActivation(),
  ): Promise<boolean> {
    if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
      throw new ProfileActivationSupersededError();
    }
    const normalized = normalizeServerUrl(profile.baseUrl, {
      allowInsecure: this.allowInsecure,
    });
    const nextProfile = { ...profile, baseUrl: normalized, isActive: true };
    const previousProfile = { ...this.activeProfile, isActive: true };
    // Read candidate credentials before touching the active profile row. If
    // secure storage is unavailable, the currently active profile and tokens
    // remain intact and the candidate is not persisted.
    const tokens = await this.tokenStore.load(nextProfile.id);
    return this.serializeProfileMutation(async () => {
      if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
        throw new ProfileActivationSupersededError();
      }
      await this.profileStore.upsert(nextProfile);
      if (activationRequestGeneration !== this.profileActivationRequestGeneration) {
        // A newer candidate started while the native store transaction was in
        // flight. Restore the last committed profile; the newer operation will
        // perform its own activation if it succeeds.
        await this.profileStore.upsert(previousProfile);
        throw new ProfileActivationSupersededError();
      }
      this.profileActivationGeneration += 1;
      this.configurationError = null;
      this.applyProfile(nextProfile);
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      return !!this.accessToken;
    });
  }

  /**
   * Validates a new server without changing the singleton client, profile
   * store, selected database, or scoped credentials. Call switchProfile only
   * after this succeeds so first-run server additions are atomic.
   */
  async verifyProfileCandidate(profile: PersistedServerProfile): Promise<PersistedServerProfile> {
    const baseUrl = normalizeServerUrl(profile.baseUrl, {
      allowInsecure: this.allowInsecure,
    });
    const response = await axios.get(`${baseUrl}/config`, { timeout: 30000 });
    const capabilities = parseServerCapabilities(response.data);
    return {
      ...profile,
      baseUrl,
      capabilities,
      lastVerifiedAt: new Date().toISOString(),
      isActive: true,
    };
  }

  // ============ Auth ============

  async login(username: string, password: string): Promise<ScopedLoginResponse> {
    try {
      const binding = await this.authenticationBinding();
      const response = await this.client.post<ApiResponse<LoginResponse>>('/auth/login', {
        username,
        password,
      }, this.authenticationRequestConfig(binding));

      if (response.data.success && response.data.data) {
        const scope = await this.persistSession(response.data.data, binding);
        return { ...response.data, scope };
      }

      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async loginForFlow(username: string, password: string): Promise<AuthFlowResult> {
    const requestedScope = this.captureAuthSessionScope();
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.post<ApiResponse<LoginResponse>>('/auth/login', {
        username,
        password,
      }, this.authenticationRequestConfig(binding));
      if (!response.data.success || !response.data.data) {
        return this.authFlowFromPayload(response.data, binding.scope);
      }
      const scope = await this.persistSession(response.data.data, binding);
      return { status: 'authenticated', session: response.data.data, scope };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return this.authFlowFromPayload(
          error.response?.data,
          requestedScope,
        );
      }
      return { status: 'error', message: 'An unexpected error occurred' };
    }
  }

  async logout(scope: AuthSessionScope = this.captureAuthSessionScope()): Promise<void> {
    // Invalidate synchronously before any await. A refresh/login response that
    // arrives after this point is stale and cannot reinstall credentials.
    invalidateSessionGeneration(scope.serverProfileId);
    this.invalidateDatabaseSelection(scope.serverProfileId);
    if (this.activeProfile.id === scope.serverProfileId) {
      this.accessToken = null;
      this.refreshToken = null;
    }

    await serializeProfileSessionMutation(scope.serverProfileId, async () => {
      const profile = this.activeProfile.id === scope.serverProfileId
        ? { ...this.activeProfile }
        : await this.profileStore.getById(scope.serverProfileId);
      const tokens = await this.tokenStore.load(scope.serverProfileId).catch(() => ({
        accessToken: null,
        refreshToken: null,
      }));
      try {
        if (profile && tokens.refreshToken) {
          await this.revokeRefreshToken(profile, tokens.refreshToken);
        }
      } finally {
        await this.clearStoredSession(scope);
      }
    });
  }

  async refreshAccessToken(
    requestedScope: AuthSessionScope = this.captureAuthSessionScope(),
  ): Promise<boolean> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      if (!binding.refreshToken) return false;
      const response = await axios.post<ApiResponse<{ access_token: string; refresh_token?: string }>>(
        `${normalizeServerUrl(binding.profile.baseUrl, {
          allowInsecure: this.allowInsecure,
        })}/auth/refresh`,
        { refresh_token: binding.refreshToken },
      );

      if (response.data.success && response.data.data) {
        const { access_token, refresh_token } = response.data.data;
        const tokens = {
          accessToken: access_token,
          refreshToken: refresh_token ?? binding.refreshToken,
        };
        return this.installRotatedTokens(
          binding.profile,
          tokens,
          binding.sessionGeneration,
        );
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  private async clearStoredSession(scope: AuthSessionScope): Promise<void> {
    await this.tokenStore.clear(scope.serverProfileId);
    await this.serializeProfileMutation(async () => {
      await this.profileStore.setSelectedDatabase(scope.serverProfileId, null);
      if (this.activeProfile.id === scope.serverProfileId) {
        this.accessToken = null;
        this.refreshToken = null;
        this.currentDatabase = null;
        this.activeProfile.selectedDatabase = null;
      }
    });
  }

  // ============ Database Selection ============

  async setCurrentDatabase(
    dbName: string | null,
    requestedScope: AuthSessionScope = this.captureAuthSessionScope(),
  ): Promise<void> {
    const profileId = requestedScope.serverProfileId;
    const requestGeneration = this.invalidateDatabaseSelection(profileId);

    await this.serializeProfileMutation(async () => {
      if (this.databaseSelectionRequestGenerations.get(profileId) !== requestGeneration) return;
      const previousDatabase = this.activeProfile.id === profileId
        ? this.currentDatabase
        : (await this.profileStore.getById(profileId))?.selectedDatabase
          ?? requestedScope.databaseId;
      if (this.databaseSelectionRequestGenerations.get(profileId) !== requestGeneration) return;

      await this.profileStore.setSelectedDatabase(profileId, dbName);
      if (this.databaseSelectionRequestGenerations.get(profileId) !== requestGeneration) {
        // A newer selection started while the native write was in flight. Put
        // durable state back on the last committed database before the newer
        // queued selection runs.
        await this.profileStore.setSelectedDatabase(profileId, previousDatabase);
        return;
      }
      if (this.activeProfile.id === profileId) {
        this.currentDatabase = dbName;
        this.activeProfile.selectedDatabase = dbName;
      }
    });
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
  }

  async verifyActiveProfile(): Promise<PersistedServerProfile> {
    const profile = { ...this.activeProfile };
    const scope = this.captureAuthSessionScope();
    const activationGeneration = this.profileActivationGeneration;
    const binding = await this.authenticationBinding(scope);
    const response = await this.client.get(
      '/config',
      this.authenticationRequestConfig(binding),
    );
    const capabilities = parseServerCapabilities(response.data);
    return this.serializeProfileMutation(async () => {
      const stillActive = this.profileActivationGeneration === activationGeneration
        && this.activeProfile.id === profile.id;
      const verified: PersistedServerProfile = {
        ...profile,
        capabilities,
        lastVerifiedAt: new Date().toISOString(),
        isActive: stillActive,
      };
      if (!stillActive) {
        // A switch away may still retain useful metadata for the inactive
        // origin. A same-ID reactivation, however, means this response was
        // based on an older activation snapshot; writing it as inactive would
        // silently leave SQLite without an active profile.
        if (this.activeProfile.id !== profile.id) {
          await this.profileStore.upsert(verified);
        }
        throw new ProfileVerificationSupersededError();
      }
      await this.profileStore.upsert(verified);
      this.applyProfile(verified);
      return { ...verified };
    });
  }

  async requestScopedMutation<T>(
    method: Method,
    path: string,
    payload: Record<string, unknown>,
    metadata: MutationMetadata,
    scope: MutationScope,
  ): Promise<T> {
    const expectedGeneration = sessionGeneration(scope.serverProfileId);
    const profile = await this.profileStore.getById(scope.serverProfileId);
    if (!profile) {
      throw new Error(`Unknown server profile for queued mutation: ${scope.serverProfileId}`);
    }
    const baseURL = normalizeServerUrl(profile.baseUrl, {
      allowInsecure: this.allowInsecure,
    });
    const tokens = await this.tokenStore.load(scope.serverProfileId);
    if (!tokens.accessToken) {
      throw new Error(`No stored session for queued mutation profile: ${scope.serverProfileId}`);
    }
    if (sessionGeneration(scope.serverProfileId) !== expectedGeneration) {
      throw new AuthSessionSupersededError();
    }

    const data = {
      ...payload,
      client_mutation_id: metadata.clientMutationId,
      ...(metadata.baseUpdatedAt ? { base_updated_at: metadata.baseUpdatedAt } : {}),
    };
    const request = (accessToken: string) => axios.request<T>({
      method,
      baseURL,
      url: path,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Database': scope.databaseId,
      },
      data,
    });

    try {
      const response = await request(tokens.accessToken);
      return response.data;
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401 || !tokens.refreshToken) {
        throw error;
      }

      const refreshResponse = await axios.post<ApiResponse<{
        access_token: string;
        refresh_token?: string;
      }>>(
        `${baseURL}/auth/refresh`,
        { refresh_token: tokens.refreshToken },
      );
      if (!refreshResponse.data.success || !refreshResponse.data.data?.access_token) {
        throw error;
      }

      const refreshedTokens = {
        accessToken: refreshResponse.data.data.access_token,
        refreshToken: refreshResponse.data.data.refresh_token ?? tokens.refreshToken,
      };
      const installed = await this.installRotatedTokens(
        profile,
        refreshedTokens,
        expectedGeneration,
      );
      if (!installed) throw new AuthSessionSupersededError();
      const response = await request(refreshedTokens.accessToken);
      return response.data;
    }
  }

  /**
   * Performs an authenticated read without activating the target profile or
   * database in the foreground client. Background synchronization uses this
   * path so one server can never inherit another server's token or X-Database
   * header while the application is suspended or terminated.
   */
  async requestScopedGet<T>(
    path: string,
    scope: MutationScope,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const expectedGeneration = sessionGeneration(scope.serverProfileId);
    const profile = await this.profileStore.getById(scope.serverProfileId);
    if (!profile) {
      throw new Error(`Unknown server profile for scoped request: ${scope.serverProfileId}`);
    }
    const baseURL = normalizeServerUrl(profile.baseUrl, {
      allowInsecure: this.allowInsecure,
    });
    const tokens = await this.tokenStore.load(scope.serverProfileId);
    if (!tokens.accessToken) {
      throw new Error(`No stored session for scoped request profile: ${scope.serverProfileId}`);
    }
    if (sessionGeneration(scope.serverProfileId) !== expectedGeneration) {
      throw new AuthSessionSupersededError();
    }

    const request = (accessToken: string) => axios.request<T>({
      method: 'GET',
      baseURL,
      url: path,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Database': scope.databaseId,
      },
      params,
    });

    try {
      const response = await request(tokens.accessToken);
      return response.data;
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401 || !tokens.refreshToken) {
        throw error;
      }

      const refreshResponse = await axios.post<ApiResponse<{
        access_token: string;
        refresh_token?: string;
      }>>(
        `${baseURL}/auth/refresh`,
        { refresh_token: tokens.refreshToken },
      );
      if (!refreshResponse.data.success || !refreshResponse.data.data?.access_token) {
        throw error;
      }

      const refreshedTokens = {
        accessToken: refreshResponse.data.data.access_token,
        refreshToken: refreshResponse.data.data.refresh_token ?? tokens.refreshToken,
      };
      const installed = await this.installRotatedTokens(
        profile,
        refreshedTokens,
        expectedGeneration,
      );
      if (!installed) throw new AuthSessionSupersededError();
      const response = await request(refreshedTokens.accessToken);
      return response.data;
    }
  }

  // ============ App Configuration ============

  async getAppConfig(): Promise<ApiResponse<{
    deployment_mode: 'saas' | 'self-hosted';
    billing_enabled: boolean;
    registration_enabled: boolean;
    email_enabled: boolean;
    email_verification_required: boolean;
  }>> {
    try {
      const response = await this.client.get('/config');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Password Reset ============

  async registerAccount(input: {
    username: string;
    email: string;
    password: string;
  }): Promise<ApiResponse<RegistrationResult>> {
    try {
      const response = await this.client.post('/auth/register', input);
      return this.normalizeAuthResponse<RegistrationResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async verifyEmail(token: string): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/verify-email', { token });
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async resendEmailVerification(email: string): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/resend-verification', { email });
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async forgotPassword(email: string): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/forgot-password', { email });
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async resetPassword(token: string, password: string): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/reset-password', { token, password });
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async changeRequiredPassword(
    changeToken: string,
    newPassword: string,
    deviceInfo?: string,
    requestedScope?: AuthSessionScope,
  ): Promise<ScopedLoginResponse> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.post<ApiResponse<LoginResponse>>('/auth/change-password', {
        change_token: changeToken,
        new_password: newPassword,
        ...(deviceInfo ? { device_info: deviceInfo } : {}),
      }, this.authenticationRequestConfig(binding));
      if (response.data.success && response.data.data) {
        const scope = await this.persistSession(response.data.data, binding);
        return { ...response.data, scope };
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getTeamInviteInfo(token: string): Promise<ApiResponse<TeamInviteInfo>> {
    try {
      const response = await this.client.get<ApiResponse<TeamInviteInfo>>('/invitations/info', {
        params: { token },
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async acceptTeamInvite(
    token: string,
    username: string,
    password: string,
  ): Promise<ApiResponse<TeamInviteAcceptance>> {
    try {
      const response = await this.client.post<ApiResponse<TeamInviteAcceptance>>(
        '/invitations/accept',
        { token, username, password },
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getShareInviteInfo(token: string): Promise<ApiResponse<ShareInviteInfo>> {
    try {
      const response = await this.client.get<ApiResponse<ShareInviteInfo>>('/share-info', {
        params: { token },
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async acceptShareInvite(token: string): Promise<ApiResponse<ShareInviteAcceptance>> {
    try {
      const response = await this.client.post<ApiResponse<ShareInviteAcceptance>>(
        '/share/accept-by-token',
        { token },
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getOAuthProviders(): Promise<ApiResponse<OAuthProvider[]>> {
    try {
      const response = await this.client.get<ApiResponse<OAuthProvider[]>>('/auth/oauth/providers');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getOAuthAuthorization(
    provider: string,
    flow: 'login' | 'link' = 'login',
    redirectUri?: string,
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<OAuthAuthorization>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.get<ApiResponse<OAuthAuthorization>>(
        `/auth/oauth/${encodeURIComponent(provider)}/authorize`,
        {
          ...this.authenticationRequestConfig(binding),
          params: {
            flow,
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
          },
        },
      );
      if (response.data.success && response.data.data?.state) {
        await this.oauthScopeStore.save(response.data.data.state, binding.scope);
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async completeOAuthCallback(
    input: OAuthCallbackParameters,
    requestedScope?: AuthSessionScope,
  ): Promise<AuthFlowResult> {
    const persistedScope = await this.oauthScopeStore.consume(input.state).catch(() => null);
    if (
      persistedScope
      && requestedScope
      && (
        persistedScope.serverProfileId !== requestedScope.serverProfileId
        || persistedScope.databaseId !== requestedScope.databaseId
      )
    ) {
      return {
        status: 'error',
        message: 'The authorization session belongs to a different server.',
      };
    }
    const fallbackScope = persistedScope ?? requestedScope;
    if (!fallbackScope) {
      return {
        status: 'error',
        message: 'The authorization session expired. Start sign-in again.',
      };
    }
    try {
      const binding = await this.authenticationBinding(fallbackScope);
      const response = await this.client.post<ApiResponse<LoginResponse>>(
        `/auth/oauth/${encodeURIComponent(input.provider)}/callback`,
        {
          code: input.code,
          state: input.state,
          ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
        },
        this.authenticationRequestConfig(binding),
      );
      if (!response.data.success || !response.data.data) {
        return this.authFlowFromPayload(response.data, binding.scope);
      }
      const scope = await this.persistSession(response.data.data, binding);
      return { status: 'authenticated', session: response.data.data, scope };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return this.authFlowFromPayload(error.response?.data, fallbackScope);
      }
      return { status: 'error', message: 'Authorization could not be completed' };
    }
  }

  async getLinkedAccounts(): Promise<ApiResponse<OAuthAccount[]>> {
    try {
      const response = await this.client.get<ApiResponse<OAuthAccount[]>>('/auth/oauth/accounts');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async unlinkOAuthAccount(provider: string): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.delete(
        `/auth/oauth/${encodeURIComponent(provider)}`,
      );
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getTwoFactorStatus(): Promise<ApiResponse<TwoFactorStatus>> {
    try {
      const response = await this.client.get<ApiResponse<TwoFactorStatus>>('/auth/2fa/status');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async beginEmailTwoFactorSetup(): Promise<ApiResponse<EmailTwoFactorSetup>> {
    try {
      const response = await this.client.post<ApiResponse<EmailTwoFactorSetup>>(
        '/auth/2fa/setup/email',
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async confirmEmailTwoFactorSetup(
    setupToken: string,
    code: string,
  ): Promise<ApiResponse<TwoFactorConfirmation>> {
    try {
      const response = await this.client.post<ApiResponse<TwoFactorConfirmation>>(
        '/auth/2fa/setup/email/confirm',
        { setup_token: setupToken, code },
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async regenerateRecoveryCodes(): Promise<ApiResponse<RecoveryCodesResult>> {
    try {
      const response = await this.client.get<ApiResponse<RecoveryCodesResult>>(
        '/auth/2fa/recovery-codes',
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getPasskeyRegistrationOptions(): Promise<ApiResponse<PasskeyRegistrationOptions>> {
    try {
      const response = await this.client.post<ApiResponse<PasskeyRegistrationOptions>>(
        '/auth/2fa/setup/passkey/options',
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async registerPasskey(
    registrationToken: string,
    credential: Record<string, unknown>,
    deviceName: string,
  ): Promise<ApiResponse<PasskeyRegistrationResult>> {
    try {
      const response = await this.client.post<ApiResponse<PasskeyRegistrationResult>>(
        '/auth/2fa/setup/passkey/register',
        {
          registration_token: registrationToken,
          credential,
          device_name: deviceName,
        },
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async listPasskeys(): Promise<ApiResponse<PasskeySummary[]>> {
    try {
      const response = await this.client.get<ApiResponse<PasskeySummary[]>>(
        '/auth/2fa/setup/passkeys',
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deletePasskey(
    passkeyId: number,
    confirmation: { password?: string; confirmationCode?: string },
  ): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.delete(
        `/auth/2fa/setup/passkey/${passkeyId}`,
        {
          data: {
            ...(confirmation.password ? { password: confirmation.password } : {}),
            ...(confirmation.confirmationCode
              ? { confirmation_code: confirmation.confirmationCode }
              : {}),
          },
        },
      );
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async sendTwoFactorDisableCode(): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/2fa/disable/send-code');
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async disableTwoFactor(confirmation: {
    password?: string;
    confirmationCode?: string;
  }): Promise<ApiResponse<MessageResult>> {
    try {
      const response = await this.client.post('/auth/2fa/disable', {
        ...(confirmation.password ? { password: confirmation.password } : {}),
        ...(confirmation.confirmationCode
          ? { confirmation_code: confirmation.confirmationCode }
          : {}),
      });
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async requestTwoFactorChallenge(
    sessionToken: string,
    method: TwoFactorMethod,
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<MessageResult>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.post('/auth/2fa/challenge', {
        session_token: sessionToken,
        method,
      }, this.authenticationRequestConfig(binding));
      return this.normalizeAuthResponse<MessageResult>(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getPasskeyAuthenticationOptions(
    sessionToken: string,
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<PasskeyAuthenticationOptions>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.post<ApiResponse<PasskeyAuthenticationOptions>>(
        '/auth/2fa/verify/passkey/options',
        { session_token: sessionToken },
        this.authenticationRequestConfig(binding),
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async verifyTwoFactor(
    sessionToken: string,
    method: TwoFactorMethod,
    payload: Record<string, unknown>,
    requestedScope?: AuthSessionScope,
  ): Promise<ScopedLoginResponse> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.post<ApiResponse<LoginResponse>>('/auth/2fa/verify', {
        session_token: sessionToken,
        method,
        ...payload,
      }, this.authenticationRequestConfig(binding));
      if (response.data.success && response.data.data) {
        const scope = await this.persistSession(response.data.data, binding);
        return { ...response.data, scope };
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteAccount(confirmation: {
    password?: string;
    confirm?: boolean;
  }, requestedScope: AuthSessionScope = this.captureAuthSessionScope()): Promise<ScopedMessageResponse> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.delete('/account', {
        ...this.authenticationRequestConfig(binding),
        data: confirmation,
      });
      const normalized = this.normalizeAuthResponse<MessageResult>(response.data);
      if (normalized.success) {
        invalidateSessionGeneration(binding.scope.serverProfileId);
        this.invalidateDatabaseSelection(binding.scope.serverProfileId);
        if (this.activeProfile.id === binding.scope.serverProfileId) {
          this.accessToken = null;
          this.refreshToken = null;
        }
        await serializeProfileSessionMutation(binding.scope.serverProfileId, () =>
          this.clearStoredSession(binding.scope));
      }
      return { ...normalized, scope: binding.scope };
    } catch (error) {
      return { ...this.handleError(error), scope: requestedScope };
    }
  }

  async getAccounts(
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<DatabaseInfo[]>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.get<ApiResponse<{ databases: DatabaseInfo[] }>>(
        '/me',
        this.authenticationRequestConfig(binding),
      );
      if (response.data.success && response.data.data) {
        return { success: true, data: response.data.data.databases };
      }
      return response.data as any;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getUserInfo(
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<{ user: User; databases: DatabaseInfo[] }>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.get<ApiResponse<{ user: User; databases: DatabaseInfo[] }>>(
        '/me',
        this.authenticationRequestConfig(binding),
      );
      return { ...response.data, httpStatus: response.status };
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateUserCurrency(
    currency: string,
    requestedScope?: AuthSessionScope,
  ): Promise<ApiResponse<{ user: User; databases: DatabaseInfo[] }>> {
    try {
      const binding = await this.authenticationBinding(requestedScope);
      const response = await this.client.patch<ApiResponse<{ user: User; databases: DatabaseInfo[] }>>(
        '/me',
        { currency },
        this.authenticationRequestConfig(binding),
      );
      return { ...response.data, httpStatus: response.status };
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Bills ============

  async getBills(includeArchived = false): Promise<ApiResponse<Bill[]>> {
    try {
      const response = await this.client.get<ApiResponse<Bill[]>>('/bills', {
        params: { include_archived: includeArchived },
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getBill(id: number): Promise<ApiResponse<Bill>> {
    try {
      const response = await this.client.get<ApiResponse<Bill>>(`/bills/${id}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createBill(bill: Partial<Bill>): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>('/bills', bill);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateBill(id: number, bill: Partial<Bill>): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/bills/${id}`, bill);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async archiveBill(id: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/bills/${id}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteBill(id: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/bills/${id}/permanent`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async unarchiveBill(id: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/bills/${id}/unarchive`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Payments ============

  async recordPayment(billId: number, amount: number, date: string, notes?: string): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>(`/bills/${billId}/pay`, {
        amount,
        payment_date: date,
        notes,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getPayments(billId: number): Promise<ApiResponse<Payment[]>> {
    try {
      const response = await this.client.get<ApiResponse<Payment[]>>(`/bills/${billId}/payments`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getAllPayments(): Promise<ApiResponse<Payment[]>> {
    try {
      const response = await this.client.get<ApiResponse<Payment[]>>('/payments');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deletePayment(id: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/payments/${id}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updatePayment(id: number, amount: number, paymentDate: string, notes?: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/payments/${id}`, {
        amount,
        payment_date: paymentDate,
        notes,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Bill Sharing ============

  async markSharePaid(shareId: number): Promise<ApiResponse<{ recipient_paid_date: string | null }>> {
    try {
      const response = await this.client.post<ApiResponse<{ recipient_paid_date: string | null }>>(`/shares/${shareId}/mark-paid`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getSettlements(): Promise<ApiResponse<SettlementsResponse>> {
    try {
      const response = await this.client.get<ApiResponse<SettlementsResponse>>('/settlements');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Sync ============

  async syncFull(): Promise<ApiResponse<SyncResponse>> {
    try {
      const response = await this.client.get<ApiResponse<SyncResponse>>('/sync/full');
      if (response.data.success && response.data.data && this.currentDatabase) {
        await this.syncRepository.setSyncState(
          this.activeProfile.id,
          this.currentDatabase,
          {
            cursor: response.data.data.server_time,
            lastSyncedAt: response.data.data.server_time,
            status: 'idle',
            lastError: null,
          },
        );
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async syncDelta(since?: string): Promise<ApiResponse<SyncResponse>> {
    try {
      const state = this.currentDatabase
        ? await this.syncRepository.getSyncState(this.activeProfile.id, this.currentDatabase)
        : null;
      const lastSync = since || state?.cursor;
      if (!lastSync) {
        return this.syncFull();
      }

      const response = await this.client.get<ApiResponse<SyncResponse>>('/sync', {
        params: { since: lastSync },
      });

      if (response.data.success && response.data.data && this.currentDatabase) {
        await this.syncRepository.setSyncState(
          this.activeProfile.id,
          this.currentDatabase,
          {
            cursor: response.data.data.server_time,
            lastSyncedAt: response.data.data.server_time,
            status: 'idle',
            lastError: null,
          },
        );
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async syncPush(changes: SyncPushRequest): Promise<ApiResponse<SyncPushResponse>> {
    try {
      const response = await this.client.post<ApiResponse<SyncPushResponse>>('/sync/push', changes);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Device & Notifications ============

  async registerDevice(deviceInfo: DeviceInfo): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>('/devices', deviceInfo);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updatePushToken(deviceId: number, pushToken: string, provider = 'expo'): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/devices/${deviceId}/push-token`, {
        push_token: pushToken,
        push_provider: provider,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Stats ============

  async getMonthlyStats(): Promise<ApiResponse<MonthlyStats[]>> {
    try {
      const response = await this.client.get<ApiResponse<MonthlyStats[]>>('/stats/monthly');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Admin: Users ============

  async getUsers(): Promise<ApiResponse<AdminUser[]>> {
    try {
      const response = await this.client.get<ApiResponse<AdminUser[]>>('/users');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteUser(userId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/users/${userId}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateUserRole(userId: number, role: 'admin' | 'user'): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/users/${userId}`, { role });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateUser(userId: number, data: { role?: 'admin' | 'user'; email?: string }): Promise<ApiResponse<AdminUser>> {
    try {
      const response = await this.client.put<ApiResponse<AdminUser>>(`/users/${userId}`, data);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createUser(data: {
    username: string;
    password: string;
    email?: string;
    role: 'admin' | 'user';
    database_ids: number[];
  }): Promise<ApiResponse<AdminUser>> {
    try {
      const response = await this.client.post<ApiResponse<AdminUser>>('/users', data);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Admin: Invitations ============

  async getInvitations(): Promise<ApiResponse<Invitation[]>> {
    try {
      const response = await this.client.get<ApiResponse<Invitation[]>>('/invitations');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createInvitation(email: string, role: 'admin' | 'user', databaseIds: number[]): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>('/invitations', {
        email,
        role,
        database_ids: databaseIds,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteInvitation(invitationId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/invitations/${invitationId}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async resendInvitation(invitationId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/invitations/${invitationId}/resend`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Admin: Databases (Bill Groups) ============

  async getDatabases(): Promise<ApiResponse<DatabaseWithAccess[]>> {
    try {
      const response = await this.client.get<ApiResponse<DatabaseWithAccess[]>>('/databases');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createDatabase(
    name: string,
    displayName: string,
    description?: string,
  ): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>('/databases', {
        name,
        display_name: displayName,
        description,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateDatabase(
    databaseId: number,
    displayName: string,
    description?: string,
  ): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/databases/${databaseId}`, {
        display_name: displayName,
        description,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteDatabase(databaseId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/databases/${databaseId}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async addDatabaseAccess(databaseId: number, userId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/databases/${databaseId}/access`, {
        user_id: userId,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async removeDatabaseAccess(databaseId: number, userId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/databases/${databaseId}/access/${userId}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Password Management ============

  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async reauthenticate(password: string): Promise<ApiResponse<{ reauthenticated: boolean }>> {
    try {
      const response = await this.client.post<ApiResponse<{ reauthenticated: boolean }>>('/auth/reauthenticate', {
        password,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Subscription & Billing ============

  async getSubscriptionStatus(): Promise<ApiResponse<SubscriptionStatus>> {
    try {
      const response = await this.client.get<ApiResponse<SubscriptionStatus>>('/billing/status');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getBillingUsage(): Promise<ApiResponse<BillingUsage>> {
    try {
      const response = await this.client.get<ApiResponse<BillingUsage>>('/billing/usage');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createCheckoutSession(tier: 'basic' | 'plus', interval: 'monthly' | 'annual'): Promise<ApiResponse<{ url: string }>> {
    try {
      const response = await this.client.post<ApiResponse<{ url: string }>>('/billing/create-checkout', {
        tier,
        interval,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async createPortalSession(): Promise<ApiResponse<{ url: string }>> {
    try {
      const response = await this.client.post<ApiResponse<{ url: string }>>('/billing/portal');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Telemetry ============

  async getTelemetryNotice(): Promise<ApiResponse<{
    show_notice: boolean;
    opted_out?: boolean;
    notice_shown_at?: string;
    reason?: string;
    telemetry_enabled?: boolean;
    deployment_mode?: string;
  }>> {
    try {
      const response = await this.client.get<ApiResponse<{
        show_notice: boolean;
        opted_out?: boolean;
        notice_shown_at?: string;
        reason?: string;
        telemetry_enabled?: boolean;
        deployment_mode?: string;
      }>>('/telemetry/notice');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async acceptTelemetry(): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>('/telemetry/accept');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async optOutTelemetry(): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>('/telemetry/opt-out');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Bill Sharing ============

  async shareBill(billId: number, data: {
    identifier: string;
    split_type?: 'percentage' | 'fixed' | 'equal' | null;
    split_value?: number | null;
  }): Promise<ApiResponse<{ share_id: number; status: string; message: string }>> {
    try {
      const response = await this.client.post<ApiResponse<{ share_id: number; status: string; message: string }>>(
        `/bills/${billId}/share`,
        data
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getBillShares(billId: number): Promise<ApiResponse<BillShare[]>> {
    try {
      const response = await this.client.get<ApiResponse<BillShare[]>>(`/bills/${billId}/shares`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async revokeShare(shareId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.delete<ApiResponse<void>>(`/shares/${shareId}`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateShare(shareId: number, data: {
    split_type?: string | null;
    split_value?: number | null;
  }): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/shares/${shareId}`, data);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getSharedBills(): Promise<ApiResponse<SharedBill[]>> {
    try {
      const response = await this.client.get<ApiResponse<SharedBill[]>>('/shared-bills');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getPendingShares(): Promise<ApiResponse<PendingShare[]>> {
    try {
      const response = await this.client.get<ApiResponse<PendingShare[]>>('/shared-bills/pending');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async acceptShare(shareId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/shares/${shareId}/accept`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async declineShare(shareId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/shares/${shareId}/decline`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async leaveShare(shareId: number): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>(`/shares/${shareId}/leave`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async searchUsers(query: string): Promise<ApiResponse<UserSearchResult[]>> {
    try {
      const response = await this.client.get<ApiResponse<UserSearchResult[]>>(
        `/users/search?q=${encodeURIComponent(query)}`
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Helpers ============

  private async serializeProfileMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.profileMutationTail.catch(() => undefined).then(mutation);
    this.profileMutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persistSession(
    session: LoginResponse,
    binding: AuthenticationRequestBinding,
  ): Promise<AuthSessionScope> {
    const requestedScope = binding.scope;
    const requestedDatabase = requestedScope.databaseId;
    const databaseId = requestedDatabase === '_all_'
      || session.databases?.some((database) => database.name === requestedDatabase)
      ? requestedDatabase
      : session.databases?.[0]?.name ?? null;
    const scope = { ...requestedScope, databaseId };

    const committed = await serializeProfileSessionMutation(scope.serverProfileId, async () => {
      if (sessionGeneration(scope.serverProfileId) !== binding.sessionGeneration) {
        await this.revokeRefreshToken(binding.profile, session.refresh_token);
        return false;
      }

      await this.tokenStore.save(scope.serverProfileId, {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      });
      if (sessionGeneration(scope.serverProfileId) !== binding.sessionGeneration) {
        await this.tokenStore.clear(scope.serverProfileId);
        await this.revokeRefreshToken(binding.profile, session.refresh_token);
        return false;
      }

      await this.setCurrentDatabase(databaseId, requestedScope);
      if (sessionGeneration(scope.serverProfileId) !== binding.sessionGeneration) {
        await this.tokenStore.clear(scope.serverProfileId);
        await this.revokeRefreshToken(binding.profile, session.refresh_token);
        return false;
      }

      invalidateSessionGeneration(scope.serverProfileId);
      // A completed request may belong to a profile that is no longer visible.
      // Its durable session stays isolated, but it must never overwrite the new
      // profile's in-memory credentials or selected database.
      if (this.activeProfile.id === scope.serverProfileId) {
        this.accessToken = session.access_token;
        this.refreshToken = session.refresh_token;
      }
      return true;
    });
    if (!committed) {
      throw new AuthSessionSupersededError();
    }
    return scope;
  }

  private async installRotatedTokens(
    profile: PersistedServerProfile,
    tokens: { accessToken: string; refreshToken: string | null },
    expectedGeneration: number,
  ): Promise<boolean> {
    return serializeProfileSessionMutation(profile.id, async () => {
      if (sessionGeneration(profile.id) !== expectedGeneration) {
        await this.revokeRefreshToken(profile, tokens.refreshToken);
        return false;
      }

      await this.tokenStore.save(profile.id, tokens);
      if (sessionGeneration(profile.id) !== expectedGeneration) {
        await this.tokenStore.clear(profile.id);
        await this.revokeRefreshToken(profile, tokens.refreshToken);
        return false;
      }

      invalidateSessionGeneration(profile.id);
      if (this.activeProfile.id === profile.id) {
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
      }
      return true;
    });
  }

  private async invalidateAndClearTokensIfCurrent(
    profileId: string,
    expectedGeneration: number,
  ): Promise<boolean> {
    return serializeProfileSessionMutation(profileId, async () => {
      if (sessionGeneration(profileId) !== expectedGeneration) return false;
      invalidateSessionGeneration(profileId);
      await this.tokenStore.clear(profileId);
      if (this.activeProfile.id === profileId) {
        this.accessToken = null;
        this.refreshToken = null;
      }
      return true;
    });
  }

  private async revokeRefreshToken(
    profile: PersistedServerProfile,
    refreshToken: string | null,
  ): Promise<void> {
    if (!refreshToken) return;
    try {
      const baseUrl = normalizeServerUrl(profile.baseUrl, {
        allowInsecure: this.allowInsecure,
      });
      await axios.post(`${baseUrl}/auth/logout`, { refresh_token: refreshToken });
    } catch {
      // Local invalidation is authoritative. Remote revocation is best effort
      // when the device disconnects during logout or a stale continuation.
    }
  }

  private invalidateDatabaseSelection(profileId: string): number {
    const next = (this.databaseSelectionRequestGenerations.get(profileId) ?? 0) + 1;
    this.databaseSelectionRequestGenerations.set(profileId, next);
    return next;
  }

  private authFlowFromPayload(
    payload: unknown,
    scope: AuthSessionScope,
  ): AuthFlowResult {
    const response = (payload ?? {}) as Record<string, unknown>;
    const methods = Array.isArray(response.twofa_methods)
      ? response.twofa_methods.filter(
          (method): method is TwoFactorMethod =>
            method === 'email_otp' || method === 'passkey' || method === 'recovery',
        )
      : [];

    if (response.twofa_required === true && typeof response.twofa_session_token === 'string') {
      return {
        status: 'two_factor_required',
        sessionToken: response.twofa_session_token,
        methods,
        scope,
      };
    }
    if (
      (response.password_change_required === true || response.require_password_change === true)
      && typeof response.change_token === 'string'
    ) {
      return {
        status: 'password_change_required',
        changeToken: response.change_token,
        scope,
      };
    }
    if (response.email_verification_required === true) {
      return {
        status: 'email_verification_required',
        message: typeof response.error === 'string'
          ? response.error
          : 'Verify your email before signing in.',
      };
    }
    return {
      status: 'error',
      message: typeof response.error === 'string' ? response.error : 'Sign in failed',
    };
  }

  private normalizeAuthResponse<T>(payload: unknown): ApiResponse<T> {
    const response = (payload ?? {}) as Record<string, unknown>;
    if (response.success !== true) {
      return {
        success: false,
        error: typeof response.error === 'string' ? response.error : 'Request failed',
      };
    }
    if (response.data !== undefined) {
      return { success: true, data: response.data as T };
    }
    const { success: _success, error: _error, ...data } = response;
    return { success: true, data: data as T };
  }

  private handleError(error: unknown): ApiResponse<any> {
    if (error instanceof ServerUrlError) {
      return {
        success: false,
        error: error.message,
      };
    }
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ApiResponse<any>>;
      if (axiosError.response?.data) {
        const response = axiosError.response.data as ApiResponse<any> & { error?: string };
        return typeof response.success === 'boolean'
          ? { ...response, httpStatus: axiosError.response.status }
          : {
              success: false,
              error: response.error ?? 'Request failed',
              httpStatus: axiosError.response.status,
            };
      }
      return {
        success: false,
        error: axiosError.message || 'Network error',
        httpStatus: axiosError.response?.status,
      };
    }
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }

  private applyProfile(profile: PersistedServerProfile): void {
    this.activeProfile = { ...profile };
    this.currentDatabase = profile.selectedDatabase;
    this.validateActiveProfile();
  }

  private validateActiveProfile(): void {
    try {
      normalizeServerUrl(this.activeProfile.baseUrl, {
        allowInsecure: this.allowInsecure,
      });
      this.configurationError = null;
    } catch (error) {
      if (error instanceof ServerUrlError) {
        this.configurationError = error;
        return;
      }
      throw error;
    }
  }
}

// Singleton instance
export const api = new BillManagerApi();
export default api;
