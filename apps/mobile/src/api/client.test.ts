import { beforeEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => {
  const state: {
    requestHandler?: (config: any) => Promise<unknown> | unknown;
    responseErrorHandler?: (error: unknown) => Promise<unknown>;
  } = {};

  const secureStoreMock = {
    setItemAsync: vi.fn(),
    getItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  };

  const mockClient = {
    defaults: {},
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn((onFulfilled) => {
          state.requestHandler = onFulfilled;
        }),
      },
      response: {
        use: vi.fn((_onFulfilled, onRejected) => {
          state.responseErrorHandler = onRejected;
        }),
      },
    },
  };

  const axiosMock = {
    create: vi.fn(() => mockClient),
    post: vi.fn(),
    get: vi.fn(),
    request: vi.fn(),
    isAxiosError: vi.fn((error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)),
  };

  return { state, secureStoreMock, mockClient, axiosMock };
});

vi.mock('expo-secure-store', () => testMocks.secureStoreMock);
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => `digest-${value}`),
  getRandomBytesAsync: vi.fn(),
  randomUUID: vi.fn(() => 'generated-id'),
}));

vi.mock('axios', () => ({
  __esModule: true,
  default: testMocks.axiosMock,
  ...testMocks.axiosMock,
}));

import { BillManagerApi } from './client';

function createApi() {
  const profileStore = {
    getActive: vi.fn().mockResolvedValue(null),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    setSelectedDatabase: vi.fn().mockResolvedValue(undefined),
  };
  const tokenStore = {
    load: vi.fn().mockResolvedValue({ accessToken: null, refreshToken: null }),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const syncRepository = {
    getSyncState: vi.fn().mockResolvedValue(null),
    setSyncState: vi.fn().mockResolvedValue(undefined),
  };
  const oauthScopes = new Map<string, { serverProfileId: string; databaseId: string | null }>();
  const oauthScopeStore = {
    save: vi.fn(async (state: string, scope: { serverProfileId: string; databaseId: string | null }) => {
      oauthScopes.set(state, { ...scope });
    }),
    consume: vi.fn(async (state: string) => {
      const scope = oauthScopes.get(state) ?? null;
      oauthScopes.delete(state);
      return scope;
    }),
  };
  return {
    api: new BillManagerApi({
      profileStore,
      tokenStore,
      legacyStorage: testMocks.secureStoreMock,
      syncRepository: syncRepository as never,
      oauthScopeStore,
      allowInsecure: false,
    }),
    profileStore,
    tokenStore,
    oauthScopeStore,
  };
}

describe('BillManagerApi security behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testMocks.state.requestHandler = undefined;
    testMocks.state.responseErrorHandler = undefined;
  });

  it('stores login tokens in the active profile only', async () => {
    testMocks.mockClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-1',
          databases: [{ id: 1, name: 'personal', display_name: 'Personal' }],
        },
      },
    });

    const { api, tokenStore, profileStore } = createApi();
    const result = await api.login('alice', 'Strongpass123');

    expect(result.success).toBe(true);
    expect(result.scope).toEqual({
      serverProfileId: 'billmanager-cloud',
      databaseId: 'personal',
    });
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith(
      'billmanager-cloud',
      'personal',
    );
  });

  it('keeps an in-flight login bound to profile A when profile B is activated', async () => {
    let resolveLogin!: (value: unknown) => void;
    testMocks.mockClient.post.mockReturnValueOnce(new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    const { api, tokenStore, profileStore } = createApi();

    const login = api.login('alice-a', 'secret-for-a');
    await vi.waitFor(() => expect(testMocks.mockClient.post).toHaveBeenCalledTimes(1));
    const loginConfig = testMocks.mockClient.post.mock.calls[0][2];

    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });

    const dispatched = await testMocks.state.requestHandler!({
      ...loginConfig,
      headers: {},
    }) as any;
    expect(dispatched).toMatchObject({
      baseURL: 'https://app.billmanager.app/api/v2',
      _serverProfileId: 'billmanager-cloud',
      _databaseId: null,
    });

    resolveLogin({
      data: {
        success: true,
        data: {
          access_token: 'access-a',
          refresh_token: 'refresh-a',
          user: { id: 1, username: 'alice-a', role: 'user' },
          databases: [{ id: 1, name: 'database-a', display_name: 'A' }],
        },
      },
    });
    const result = await login;

    expect(result.scope).toEqual({
      serverProfileId: 'billmanager-cloud',
      databaseId: 'database-a',
    });
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    expect(tokenStore.save).not.toHaveBeenCalledWith(
      'server-b',
      expect.objectContaining({ accessToken: 'access-a' }),
    );
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith(
      'billmanager-cloud',
      'database-a',
    );
    expect(profileStore.setSelectedDatabase).not.toHaveBeenCalledWith(
      'server-b',
      'database-a',
    );
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
  });

  it('rotates refresh token and persists both tokens after refresh', async () => {
    testMocks.axiosMock.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          access_token: 'access-token-2',
          refresh_token: 'refresh-token-2',
        },
      },
    });

    const { api, tokenStore } = createApi();
    (api as unknown as { refreshToken: string | null }).refreshToken = 'refresh-token-1';

    const refreshed = await api.refreshAccessToken();

    expect(refreshed).toBe(true);
    expect((api as unknown as { refreshToken: string | null }).refreshToken).toBe('refresh-token-2');
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
    });
  });

  it('cannot reinstall a rotated token after logout completes', async () => {
    let resolveRefresh!: (value: unknown) => void;
    testMocks.axiosMock.post
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRefresh = resolve;
      }))
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { success: true } });
    const { api, tokenStore } = createApi();
    tokenStore.load.mockResolvedValue({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });
    (api as unknown as { accessToken: string | null }).accessToken = 'access-token-1';
    (api as unknown as { refreshToken: string | null }).refreshToken = 'refresh-token-1';

    const refresh = api.refreshAccessToken();
    await vi.waitFor(() => expect(testMocks.axiosMock.post).toHaveBeenCalledTimes(1));
    await api.logout({ serverProfileId: 'billmanager-cloud', databaseId: 'personal' });

    resolveRefresh({
      data: {
        success: true,
        data: { access_token: 'late-access', refresh_token: 'late-refresh' },
      },
    });

    await expect(refresh).resolves.toBe(false);
    expect(tokenStore.save).not.toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'late-access',
      refreshToken: 'late-refresh',
    });
    expect((api as unknown as { accessToken: string | null }).accessToken).toBeNull();
    expect((api as unknown as { refreshToken: string | null }).refreshToken).toBeNull();
    expect(testMocks.axiosMock.post).toHaveBeenCalledWith(
      'https://app.billmanager.app/api/v2/auth/logout',
      { refresh_token: 'late-refresh' },
    );
  });

  it('revokes and discards a login response that completes after logout', async () => {
    let resolveLogin!: (value: unknown) => void;
    testMocks.mockClient.post.mockReturnValueOnce(new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    testMocks.axiosMock.post.mockResolvedValue({ data: { success: true } });
    const { api, tokenStore } = createApi();

    const login = api.login('alice', 'Strongpass123');
    await vi.waitFor(() => expect(testMocks.mockClient.post).toHaveBeenCalledTimes(1));
    await api.logout({ serverProfileId: 'billmanager-cloud', databaseId: null });
    resolveLogin({
      data: {
        success: true,
        data: {
          access_token: 'late-login-access',
          refresh_token: 'late-login-refresh',
          databases: [{ id: 1, name: 'personal', display_name: 'Personal' }],
        },
      },
    });

    await expect(login).resolves.toMatchObject({ success: false });
    expect(tokenStore.save).not.toHaveBeenCalledWith(
      'billmanager-cloud',
      expect.objectContaining({ accessToken: 'late-login-access' }),
    );
    expect(testMocks.axiosMock.post).toHaveBeenCalledWith(
      'https://app.billmanager.app/api/v2/auth/logout',
      { refresh_token: 'late-login-refresh' },
    );
  });

  it('does not install a refreshed profile A token into profile B after a switch', async () => {
    let resolveRefresh!: (value: unknown) => void;
    testMocks.axiosMock.post.mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const { api, tokenStore } = createApi();
    (api as unknown as { refreshToken: string | null }).refreshToken = 'refresh-a';

    const refresh = api.refreshAccessToken();
    await vi.waitFor(() => expect(testMocks.axiosMock.post).toHaveBeenCalledTimes(1));
    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });
    resolveRefresh({
      data: {
        success: true,
        data: { access_token: 'refreshed-a', refresh_token: 'rotated-a' },
      },
    });

    await expect(refresh).resolves.toBe(true);
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'refreshed-a',
      refreshToken: 'rotated-a',
    });
    expect(tokenStore.save).not.toHaveBeenCalledWith(
      'server-b',
      expect.objectContaining({ accessToken: 'refreshed-a' }),
    );
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
  });

  it('invokes auth error handler when interceptor cannot refresh on 401', async () => {
    testMocks.axiosMock.post.mockRejectedValueOnce(new Error('refresh failed'));

    const { api, profileStore } = createApi();
    const onAuthError = vi.fn();
    api.setAuthErrorHandler(onAuthError);
    (api as unknown as { refreshToken: string | null }).refreshToken = 'expired-refresh';
    profileStore.getById.mockResolvedValueOnce({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: true,
    });

    expect(testMocks.state.responseErrorHandler).toBeDefined();
    await expect(testMocks.state.responseErrorHandler!({
      response: { status: 401 },
      config: {
        _serverProfileId: 'billmanager-cloud',
        _refreshToken: 'expired-refresh',
      },
    })).rejects.toBeTruthy();

    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('binds origin, credential, and database snapshots to each request', async () => {
    const { api } = createApi();
    (api as unknown as { accessToken: string | null }).accessToken = 'cloud-access';
    (api as unknown as { refreshToken: string | null }).refreshToken = 'cloud-refresh';
    await api.setCurrentDatabase('personal');

    expect(testMocks.state.requestHandler).toBeDefined();
    const config = await testMocks.state.requestHandler!({ headers: {} }) as any;

    expect(config).toMatchObject({
      baseURL: 'https://app.billmanager.app/api/v2',
      _serverProfileId: 'billmanager-cloud',
      _refreshToken: 'cloud-refresh',
      headers: {
        Authorization: 'Bearer cloud-access',
        'X-Database': 'personal',
      },
    });
    expect(testMocks.mockClient.defaults).not.toHaveProperty('baseURL');
  });

  it('refreshes an in-flight request in its original profile after a profile switch', async () => {
    const { api, profileStore, tokenStore } = createApi();
    (api as unknown as { accessToken: string | null }).accessToken = 'cloud-access';
    (api as unknown as { refreshToken: string | null }).refreshToken = 'cloud-refresh';
    await api.setCurrentDatabase('personal');
    const originalRequest = await testMocks.state.requestHandler!({ headers: {} }) as any;

    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'home-access',
      refreshToken: 'home-refresh',
    });
    await api.switchProfile({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'family',
      isActive: true,
    });
    profileStore.getById.mockResolvedValueOnce({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'personal',
      isActive: false,
    });
    testMocks.axiosMock.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { access_token: 'cloud-access-2', refresh_token: 'cloud-refresh-2' },
      },
    });
    testMocks.axiosMock.request.mockResolvedValueOnce({ data: { success: true } });

    await expect(testMocks.state.responseErrorHandler!({
      response: { status: 401 },
      config: originalRequest,
    })).resolves.toEqual({ data: { success: true } });

    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'cloud-access-2',
      refreshToken: 'cloud-refresh-2',
    });
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('home-access');
    expect(testMocks.axiosMock.request).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://app.billmanager.app/api/v2',
      _serverProfileId: 'billmanager-cloud',
      headers: expect.objectContaining({
        Authorization: 'Bearer cloud-access-2',
        'X-Database': 'personal',
      }),
    }));
  });

  it('loads only the selected profile credentials when switching servers', async () => {
    const { api, tokenStore, profileStore } = createApi();
    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'self-hosted-access',
      refreshToken: 'self-hosted-refresh',
    });

    const authenticated = await api.switchProfile({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'family',
      isActive: true,
    });

    expect(authenticated).toBe(true);
    expect(profileStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-home',
      baseUrl: 'https://bills.home.example/api/v2',
      isActive: true,
    }));
    expect(tokenStore.load).toHaveBeenCalledWith('server-home');
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe(
      'self-hosted-access',
    );
  });

  it('verifies a candidate server without persisting or activating it', async () => {
    testMocks.axiosMock.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          mobile: {
            mobile_contract_version: 1,
            server_version: '4.3.0',
            features: { registration: true },
          },
        },
      },
    });
    const { api, tokenStore, profileStore } = createApi();

    const verified = await api.verifyProfileCandidate({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: true,
    });

    expect(verified).toMatchObject({
      id: 'server-home',
      baseUrl: 'https://bills.home.example/api/v2',
      capabilities: { mobileContractVersion: 1, serverVersion: '4.3.0' },
    });
    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
    expect(profileStore.upsert).not.toHaveBeenCalled();
    expect(tokenStore.load).not.toHaveBeenCalled();
  });

  it('never applies profile A capabilities to B when active verification finishes late', async () => {
    let resolveVerification!: (value: unknown) => void;
    testMocks.mockClient.get.mockReturnValueOnce(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const { api, tokenStore, profileStore } = createApi();

    const verification = api.verifyActiveProfile();
    await vi.waitFor(() => expect(testMocks.mockClient.get).toHaveBeenCalledTimes(1));
    const verificationConfig = testMocks.mockClient.get.mock.calls[0][1];

    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'family',
      isActive: true,
    });
    const dispatched = await testMocks.state.requestHandler!({
      ...verificationConfig,
      headers: {},
    }) as any;
    expect(dispatched.baseURL).toBe('https://app.billmanager.app/api/v2');
    expect(dispatched._serverProfileId).toBe('billmanager-cloud');

    resolveVerification({
      data: {
        success: true,
        data: {
          mobile: {
            mobile_contract_version: 1,
            server_version: 'cloud-version',
            default_currency: 'USD',
            default_locale: 'en-US',
            features: { registration: true, billing: true },
          },
        },
      },
    });

    await expect(verification).rejects.toThrow(
      'The active server changed while verification was completing.',
    );
    expect(profileStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'billmanager-cloud',
      isActive: false,
      capabilities: expect.objectContaining({ serverVersion: 'cloud-version' }),
    }));
    expect(profileStore.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-b',
      capabilities: expect.objectContaining({ serverVersion: 'cloud-version' }),
    }));
    expect(api.getActiveProfile()).toMatchObject({ id: 'server-b', capabilities: null });
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
  });

  it('never deactivates the active row when same-profile verification is superseded', async () => {
    let resolveVerification!: (value: unknown) => void;
    testMocks.mockClient.get.mockReturnValueOnce(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const { api, tokenStore, profileStore } = createApi();

    const verification = api.verifyActiveProfile();
    await vi.waitFor(() => expect(testMocks.mockClient.get).toHaveBeenCalledTimes(1));
    tokenStore.load.mockResolvedValueOnce({ accessToken: 'cloud-access', refreshToken: 'cloud-refresh' });
    await api.switchProfile({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'personal',
      isActive: true,
    });

    resolveVerification({
      data: {
        success: true,
        data: {
          mobile: {
            mobile_contract_version: 1,
            server_version: 'stale-cloud-version',
            default_currency: 'USD',
            default_locale: 'en-US',
            features: { registration: true, billing: true },
          },
        },
      },
    });

    await expect(verification).rejects.toThrow(
      'The active server changed while verification was completing.',
    );
    expect(profileStore.upsert).toHaveBeenCalledTimes(1);
    expect(profileStore.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      id: 'billmanager-cloud',
      isActive: false,
      capabilities: expect.objectContaining({ serverVersion: 'stale-cloud-version' }),
    }));
    expect(api.getActiveProfile()).toMatchObject({
      id: 'billmanager-cloud',
      selectedDatabase: 'personal',
      isActive: true,
    });
  });

  it('keeps the active profile and tokens when candidate verification fails', async () => {
    testMocks.axiosMock.get.mockRejectedValueOnce(new Error('certificate rejected'));
    const { api, tokenStore, profileStore } = createApi();
    (api as unknown as { accessToken: string | null }).accessToken = 'cloud-access';
    (api as unknown as { refreshToken: string | null }).refreshToken = 'cloud-refresh';

    await expect(api.verifyProfileCandidate({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: true,
    })).rejects.toThrow('certificate rejected');

    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('cloud-access');
    expect((api as unknown as { refreshToken: string | null }).refreshToken).toBe('cloud-refresh');
    expect(profileStore.upsert).not.toHaveBeenCalled();
    expect(tokenStore.load).not.toHaveBeenCalled();
  });

  it('does not persist a switch when candidate credential loading fails', async () => {
    const { api, tokenStore, profileStore } = createApi();
    tokenStore.load.mockRejectedValueOnce(new Error('secure storage unavailable'));

    await expect(api.switchProfile({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: true,
    })).rejects.toThrow('secure storage unavailable');

    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
    expect(profileStore.upsert).not.toHaveBeenCalled();
  });

  it('keeps the latest-started profile when an older token load finishes last', async () => {
    let resolveProfileA!: (tokens: { accessToken: string; refreshToken: string }) => void;
    const profileATokens = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      resolveProfileA = resolve;
    });
    const { api, tokenStore, profileStore } = createApi();
    tokenStore.load.mockImplementation((profileId: string) => {
      if (profileId === 'server-a') return profileATokens;
      if (profileId === 'server-b') {
        return Promise.resolve({ accessToken: 'access-b', refreshToken: 'refresh-b' });
      }
      return Promise.resolve({ accessToken: null, refreshToken: null });
    });

    const switchToA = api.switchProfile({
      id: 'server-a',
      displayName: 'Server A',
      baseUrl: 'https://server-a.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-a',
      isActive: true,
    });
    await vi.waitFor(() => expect(tokenStore.load).toHaveBeenCalledWith('server-a'));

    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });
    resolveProfileA({ accessToken: 'access-a', refreshToken: 'refresh-a' });

    await expect(switchToA).rejects.toThrow(
      'A newer server profile activation superseded this request.',
    );
    expect(profileStore.upsert).toHaveBeenCalledTimes(1);
    expect(profileStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'server-b',
      isActive: true,
    }));
    expect(api.getActiveProfile().id).toBe('server-b');
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
  });

  it('serializes database writes so the latest explicit selection wins', async () => {
    let resolveFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    });
    const { api, profileStore } = createApi();
    profileStore.setSelectedDatabase
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValue(undefined);

    const selectB = api.setCurrentDatabase('database-b');
    await vi.waitFor(() => {
      expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith(
        'billmanager-cloud',
        'database-b',
      );
    });
    const selectC = api.setCurrentDatabase('database-c');

    await Promise.resolve();
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledTimes(1);
    resolveFirstWrite();
    await Promise.all([selectB, selectC]);

    expect(profileStore.setSelectedDatabase.mock.calls).toEqual([
      ['billmanager-cloud', 'database-b'],
      ['billmanager-cloud', null],
      ['billmanager-cloud', 'database-c'],
    ]);
    expect(api.getCurrentDatabase()).toBe('database-c');
    expect(api.getActiveProfile().selectedDatabase).toBe('database-c');
  });

  it('keeps the durable and in-memory database cleared after logout races a selection', async () => {
    let resolveSelectionWrite!: () => void;
    const selectionWrite = new Promise<void>((resolve) => {
      resolveSelectionWrite = resolve;
    });
    const { api, profileStore } = createApi();
    profileStore.setSelectedDatabase
      .mockReturnValueOnce(selectionWrite)
      .mockResolvedValue(undefined);

    const selection = api.setCurrentDatabase('database-b');
    await vi.waitFor(() => expect(profileStore.setSelectedDatabase).toHaveBeenCalledTimes(1));
    const logout = api.logout({ serverProfileId: 'billmanager-cloud', databaseId: null });
    resolveSelectionWrite();
    await Promise.all([selection, logout]);

    expect(profileStore.setSelectedDatabase.mock.calls.at(-1)).toEqual([
      'billmanager-cloud',
      null,
    ]);
    expect(api.getCurrentDatabase()).toBeNull();
    expect(api.getActiveProfile().selectedDatabase).toBeNull();
  });

  it('keeps the durable and in-memory database cleared after deletion races a selection', async () => {
    let resolveSelectionWrite!: () => void;
    const selectionWrite = new Promise<void>((resolve) => {
      resolveSelectionWrite = resolve;
    });
    testMocks.mockClient.delete.mockResolvedValueOnce({
      data: { success: true, data: { message: 'Account deleted' } },
    });
    const { api, profileStore } = createApi();
    profileStore.setSelectedDatabase
      .mockReturnValueOnce(selectionWrite)
      .mockResolvedValue(undefined);

    const selection = api.setCurrentDatabase('database-b');
    await vi.waitFor(() => expect(profileStore.setSelectedDatabase).toHaveBeenCalledTimes(1));
    const deletion = api.deleteAccount({ password: 'Strongpass123' });
    await vi.waitFor(() => expect(testMocks.mockClient.delete).toHaveBeenCalledTimes(1));
    resolveSelectionWrite();
    await Promise.all([selection, deletion]);

    expect(profileStore.setSelectedDatabase.mock.calls.at(-1)).toEqual([
      'billmanager-cloud',
      null,
    ]);
    expect(api.getCurrentDatabase()).toBeNull();
    expect(api.getActiveProfile().selectedDatabase).toBeNull();
  });

  it('distinguishes an authentication rejection from an unreachable /me endpoint', async () => {
    const { api } = createApi();
    testMocks.mockClient.get
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Network request failed',
      })
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: { success: false, error: 'Invalid token' },
        },
      });

    await expect(api.getUserInfo()).resolves.toEqual({
      success: false,
      error: 'Network request failed',
      httpStatus: undefined,
    });
    await expect(api.getUserInfo()).resolves.toEqual({
      success: false,
      error: 'Invalid token',
      httpStatus: 401,
    });
  });

  it('keeps scoped user refresh and database selection on profile A after switching to B', async () => {
    const { api, tokenStore, profileStore } = createApi();
    const scopeA = api.captureAuthSessionScope();
    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });
    profileStore.getById.mockResolvedValueOnce({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    testMocks.mockClient.get.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        data: {
          user: { id: 1, username: 'alice-a', role: 'user' },
          databases: [{ id: 1, name: 'database-a', display_name: 'A' }],
        },
      },
    });

    await expect(api.getUserInfo(scopeA)).resolves.toMatchObject({ success: true });
    const readConfig = testMocks.mockClient.get.mock.calls[0][1];
    const dispatched = await testMocks.state.requestHandler!({
      ...readConfig,
      headers: {},
    }) as any;
    expect(dispatched).toMatchObject({
      baseURL: 'https://app.billmanager.app/api/v2',
      _serverProfileId: 'billmanager-cloud',
      headers: { Authorization: 'Bearer access-a' },
    });

    await api.setCurrentDatabase('database-a', scopeA);
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith(
      'billmanager-cloud',
      'database-a',
    );
    expect(api.getCurrentDatabase()).toBe('database-b');
  });

  it('returns a typed two-factor challenge without storing challenge credentials', async () => {
    testMocks.mockClient.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          success: false,
          twofa_required: true,
          twofa_session_token: 'challenge-token',
          twofa_methods: ['email_otp', 'passkey', 'recovery', 'unknown'],
        },
      },
    });

    const { api, tokenStore } = createApi();
    const result = await api.loginForFlow('alice', 'Strongpass123');

    expect(result).toEqual({
      status: 'two_factor_required',
      sessionToken: 'challenge-token',
      methods: ['email_otp', 'passkey', 'recovery'],
      scope: { serverProfileId: 'billmanager-cloud', databaseId: null },
    });
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it('completes a profile A two-factor challenge without sending or storing it as B', async () => {
    testMocks.mockClient.post
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 403,
          data: {
            success: false,
            twofa_required: true,
            twofa_session_token: 'challenge-a',
            twofa_methods: ['email_otp'],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            access_token: 'verified-a',
            refresh_token: 'verified-refresh-a',
            user: { id: 1, username: 'alice-a', role: 'user' },
            databases: [{ id: 1, name: 'database-a', display_name: 'A' }],
          },
        },
      });
    const { api, tokenStore, profileStore } = createApi();
    const challenge = await api.loginForFlow('alice-a', 'secret-for-a');
    expect(challenge.status).toBe('two_factor_required');
    if (challenge.status !== 'two_factor_required') throw new Error('challenge expected');

    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });
    profileStore.getById.mockResolvedValueOnce({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({ accessToken: null, refreshToken: null });

    const response = await api.verifyTwoFactor(
      challenge.sessionToken,
      'email_otp',
      { code: '123456' },
      challenge.scope,
    );
    const verifyConfig = testMocks.mockClient.post.mock.calls[1][2];
    const dispatched = await testMocks.state.requestHandler!({
      ...verifyConfig,
      headers: {},
    }) as any;

    expect(dispatched.baseURL).toBe('https://app.billmanager.app/api/v2');
    expect(dispatched._serverProfileId).toBe('billmanager-cloud');
    expect(response.scope).toEqual({
      serverProfileId: 'billmanager-cloud',
      databaseId: 'database-a',
    });
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'verified-a',
      refreshToken: 'verified-refresh-a',
    });
    expect(tokenStore.save).not.toHaveBeenCalledWith(
      'server-b',
      expect.objectContaining({ accessToken: 'verified-a' }),
    );
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
  });

  it('routes forced password changes without exposing the password in the result', async () => {
    testMocks.mockClient.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          success: false,
          password_change_required: true,
          change_token: 'single-use-change-token',
        },
      },
    });

    const { api } = createApi();
    await expect(api.loginForFlow('alice', 'Strongpass123')).resolves.toEqual({
      status: 'password_change_required',
      changeToken: 'single-use-change-token',
      scope: { serverProfileId: 'billmanager-cloud', databaseId: null },
    });
  });

  it('normalizes top-level registration responses used by the server', async () => {
    testMocks.mockClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Check your email',
        email_verification_required: true,
        email_sent: true,
        user: { id: 5, username: 'alice', email: 'alice@example.com' },
      },
    });

    const { api } = createApi();
    const response = await api.registerAccount({
      username: 'alice',
      email: 'alice@example.com',
      password: 'Strongpass123',
    });

    expect(response).toEqual({
      success: true,
      data: expect.objectContaining({
        message: 'Check your email',
        email_verification_required: true,
      }),
    });
  });

  it('recovers the authorization-start scope for a cold OAuth callback after A to B switch', async () => {
    testMocks.mockClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { auth_url: 'https://identity.example/authorize', state: 'oauth-state-a' },
      },
    });
    testMocks.mockClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          access_token: 'oauth-access-a',
          refresh_token: 'oauth-refresh-a',
          user: { id: 1, username: 'alice-a', role: 'user' },
          databases: [{ id: 1, name: 'database-a', display_name: 'A' }],
        },
      },
    });
    const { api, tokenStore, profileStore, oauthScopeStore } = createApi();

    await expect(api.getOAuthAuthorization('oidc')).resolves.toMatchObject({ success: true });
    expect(oauthScopeStore.save).toHaveBeenCalledWith('oauth-state-a', {
      serverProfileId: 'billmanager-cloud',
      databaseId: null,
    });

    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'database-b',
      isActive: true,
    });
    profileStore.getById.mockResolvedValueOnce({
      id: 'billmanager-cloud',
      displayName: 'BillManager Cloud',
      baseUrl: 'https://app.billmanager.app/api/v2',
      deploymentMode: 'saas',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: null,
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({ accessToken: null, refreshToken: null });

    const result = await api.completeOAuthCallback({
      provider: 'oidc',
      code: 'authorization-code-a',
      state: 'oauth-state-a',
    });
    const callbackConfig = testMocks.mockClient.post.mock.calls[0][2];
    const dispatched = await testMocks.state.requestHandler!({
      ...callbackConfig,
      headers: {},
    }) as any;

    expect(dispatched.baseURL).toBe('https://app.billmanager.app/api/v2');
    expect(dispatched._serverProfileId).toBe('billmanager-cloud');
    expect(result).toMatchObject({
      status: 'authenticated',
      scope: { serverProfileId: 'billmanager-cloud', databaseId: 'database-a' },
    });
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'oauth-access-a',
      refreshToken: 'oauth-refresh-a',
    });
    await expect(oauthScopeStore.consume('oauth-state-a')).resolves.toBeNull();
  });

  it('rejects an OAuth callback when an explicit scope disagrees with its stored state binding', async () => {
    const { api, oauthScopeStore } = createApi();
    await oauthScopeStore.save('oauth-state-a', {
      serverProfileId: 'billmanager-cloud',
      databaseId: 'personal',
    });

    await expect(api.completeOAuthCallback({
      provider: 'oidc',
      code: 'authorization-code-a',
      state: 'oauth-state-a',
    }, {
      serverProfileId: 'server-b',
      databaseId: 'family',
    })).resolves.toEqual({
      status: 'error',
      message: 'The authorization session belongs to a different server.',
    });
    expect(testMocks.mockClient.post).not.toHaveBeenCalled();
  });

  it('stores verified two-factor tokens in the active profile', async () => {
    testMocks.mockClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          access_token: 'twofa-access',
          refresh_token: 'twofa-refresh',
          user: { id: 5, username: 'alice', role: 'user' },
          databases: [{ id: 1, name: 'personal', display_name: 'Personal' }],
        },
      },
    });

    const { api, tokenStore } = createApi();
    const response = await api.verifyTwoFactor('challenge-token', 'email_otp', { code: '123456' });

    expect(response.success).toBe(true);
    expect(response.scope).toEqual({
      serverProfileId: 'billmanager-cloud',
      databaseId: 'personal',
    });
    expect(tokenStore.save).toHaveBeenCalledWith('billmanager-cloud', {
      accessToken: 'twofa-access',
      refreshToken: 'twofa-refresh',
    });
  });

  it('clears only the active profile after account deletion', async () => {
    testMocks.mockClient.delete.mockResolvedValueOnce({
      data: { success: true, data: { message: 'Account deleted' } },
    });

    const { api, tokenStore, profileStore } = createApi();
    const response = await api.deleteAccount({ password: 'Strongpass123' });

    expect(response.success).toBe(true);
    expect(response.scope).toEqual({
      serverProfileId: 'billmanager-cloud',
      databaseId: null,
    });
    expect(tokenStore.clear).toHaveBeenCalledWith('billmanager-cloud');
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith('billmanager-cloud', null);
  });

  it('keeps account deletion bound to A and never clears B after a profile switch', async () => {
    let resolveDeletion!: (value: unknown) => void;
    testMocks.mockClient.delete.mockReturnValueOnce(new Promise((resolve) => {
      resolveDeletion = resolve;
    }));
    const { api, tokenStore, profileStore } = createApi();
    const deletion = api.deleteAccount({ password: 'Strongpass123' });
    await vi.waitFor(() => expect(testMocks.mockClient.delete).toHaveBeenCalledTimes(1));
    const deletionConfig = testMocks.mockClient.delete.mock.calls[0][1];

    tokenStore.load.mockResolvedValueOnce({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    await api.switchProfile({
      id: 'server-b',
      displayName: 'Server B',
      baseUrl: 'https://server-b.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'family',
      isActive: true,
    });
    const dispatched = await testMocks.state.requestHandler!({
      ...deletionConfig,
      headers: {},
    }) as any;
    expect(dispatched.baseURL).toBe('https://app.billmanager.app/api/v2');
    expect(dispatched._serverProfileId).toBe('billmanager-cloud');

    resolveDeletion({ data: { success: true, data: { message: 'Account deleted' } } });
    await expect(deletion).resolves.toMatchObject({
      success: true,
      scope: { serverProfileId: 'billmanager-cloud', databaseId: null },
    });

    expect(tokenStore.clear).toHaveBeenCalledWith('billmanager-cloud');
    expect(tokenStore.clear).not.toHaveBeenCalledWith('server-b');
    expect(profileStore.setSelectedDatabase).toHaveBeenCalledWith('billmanager-cloud', null);
    expect(profileStore.setSelectedDatabase).not.toHaveBeenCalledWith('server-b', null);
    expect((api as unknown as { accessToken: string | null }).accessToken).toBe('access-b');
    expect((api as unknown as { refreshToken: string | null }).refreshToken).toBe('refresh-b');
  });

  it('loads team invitations through the canonical v2 endpoint', async () => {
    testMocks.mockClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          email: 'invitee@example.com',
          invited_by: 'owner',
          expires_at: '2026-07-20T12:00:00Z',
        },
      },
    });

    const { api } = createApi();
    const response = await api.getTeamInviteInfo('invite-token');

    expect(response.success).toBe(true);
    expect(testMocks.mockClient.get).toHaveBeenCalledWith(
      '/invitations/info',
      expect.objectContaining({ params: { token: 'invite-token' } }),
    );
  });

  it('sends localized bill-group descriptions on create and update', async () => {
    testMocks.mockClient.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 12 } },
    });
    testMocks.mockClient.put.mockResolvedValueOnce({
      data: { success: true },
    });

    const { api } = createApi();
    await api.createDatabase('household', 'Household', 'Shared household bills');
    await api.updateDatabase(12, 'Home', 'Recurring home expenses');

    expect(testMocks.mockClient.post).toHaveBeenCalledWith('/databases', {
      name: 'household',
      display_name: 'Household',
      description: 'Shared household bills',
    });
    expect(testMocks.mockClient.put).toHaveBeenCalledWith('/databases/12', {
      display_name: 'Home',
      description: 'Recurring home expenses',
    });
  });

  it('executes queued mutations against their persisted scope after the active profile changes', async () => {
    const { api, profileStore, tokenStore } = createApi();
    profileStore.getById.mockResolvedValueOnce({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'personal',
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'home-access-token',
      refreshToken: 'home-refresh-token',
    });
    testMocks.axiosMock.request.mockResolvedValueOnce({
      data: { success: true, data: { id: 91 } },
    });

    const response = await api.requestScopedMutation(
      'POST',
      '/bills/44/pay',
      { amount: 125 },
      { clientMutationId: 'mutation-1', baseUpdatedAt: null },
      { serverProfileId: 'server-home', databaseId: 'family' },
    );

    expect(profileStore.getById).toHaveBeenCalledWith('server-home');
    expect(tokenStore.load).toHaveBeenCalledWith('server-home');
    expect(testMocks.axiosMock.request).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://bills.home.example/api/v2',
      url: '/bills/44/pay',
      headers: expect.objectContaining({
        Authorization: 'Bearer home-access-token',
        'X-Database': 'family',
      }),
      data: {
        amount: 125,
        client_mutation_id: 'mutation-1',
      },
    }));
    expect(response).toEqual({ success: true, data: { id: 91 } });
    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
  });

  it('reads a background scope with only that profile token and database header', async () => {
    const { api, profileStore, tokenStore } = createApi();
    profileStore.getById.mockResolvedValueOnce({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'personal',
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'home-access-token',
      refreshToken: 'home-refresh-token',
    });
    testMocks.axiosMock.request.mockResolvedValueOnce({
      data: { success: true, data: [{ id: 11, name: 'Rent' }] },
    });

    await expect(api.requestScopedGet(
      '/bills',
      { serverProfileId: 'server-home', databaseId: 'family' },
      { include_archived: true },
    )).resolves.toEqual({ success: true, data: [{ id: 11, name: 'Rent' }] });

    expect(testMocks.axiosMock.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      baseURL: 'https://bills.home.example/api/v2',
      url: '/bills',
      headers: {
        Authorization: 'Bearer home-access-token',
        'X-Database': 'family',
      },
      params: { include_archived: true },
    }));
    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
  });

  it('refreshes only the queued mutation profile and retries within the same scope', async () => {
    const { api, profileStore, tokenStore } = createApi();
    profileStore.getById.mockResolvedValueOnce({
      id: 'server-home',
      displayName: 'Home',
      baseUrl: 'https://bills.home.example/api/v2',
      deploymentMode: 'self_hosted',
      lastVerifiedAt: null,
      capabilities: null,
      selectedDatabase: 'family',
      isActive: false,
    });
    tokenStore.load.mockResolvedValueOnce({
      accessToken: 'expired-home-access',
      refreshToken: 'home-refresh',
    });
    testMocks.axiosMock.request
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
      .mockResolvedValueOnce({ data: { success: true, data: { id: 92 } } });
    testMocks.axiosMock.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { access_token: 'fresh-home-access', refresh_token: 'fresh-home-refresh' },
      },
    });

    await api.requestScopedMutation(
      'DELETE',
      '/payments/92',
      {},
      { clientMutationId: 'mutation-2', baseUpdatedAt: '2026-07-15T12:00:00Z' },
      { serverProfileId: 'server-home', databaseId: 'family' },
    );

    expect(testMocks.axiosMock.post).toHaveBeenCalledWith(
      'https://bills.home.example/api/v2/auth/refresh',
      { refresh_token: 'home-refresh' },
    );
    expect(tokenStore.save).toHaveBeenCalledWith('server-home', {
      accessToken: 'fresh-home-access',
      refreshToken: 'fresh-home-refresh',
    });
    expect(testMocks.axiosMock.request).toHaveBeenLastCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-home-access',
        'X-Database': 'family',
      }),
    }));
    expect(api.getActiveProfile().id).toBe('billmanager-cloud');
  });
});
