import { beforeEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => {
  const state: { responseErrorHandler?: (error: unknown) => Promise<unknown> } = {};

  const secureStoreMock = {
    setItemAsync: vi.fn(),
    getItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  };

  const mockClient = {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn(),
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
    isAxiosError: vi.fn((error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)),
  };

  return { state, secureStoreMock, mockClient, axiosMock };
});

vi.mock('expo-secure-store', () => testMocks.secureStoreMock);

vi.mock('axios', () => ({
  __esModule: true,
  default: testMocks.axiosMock,
  ...testMocks.axiosMock,
}));

import { BillManagerApi } from './client';

describe('BillManagerApi security behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testMocks.state.responseErrorHandler = undefined;
  });

  it('stores login tokens in SecureStore with secure options', async () => {
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

    const api = new BillManagerApi();
    const result = await api.login('alice', 'Strongpass123');

    expect(result.success).toBe(true);
    expect(testMocks.secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'billmanager_access_token',
      'access-token-1',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(testMocks.secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'billmanager_refresh_token',
      'refresh-token-1',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(testMocks.secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'billmanager_current_database',
      'personal',
    );
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

    const api = new BillManagerApi();
    (api as unknown as { refreshToken: string | null }).refreshToken = 'refresh-token-1';

    const refreshed = await api.refreshAccessToken();

    expect(refreshed).toBe(true);
    expect((api as unknown as { refreshToken: string | null }).refreshToken).toBe('refresh-token-2');
    expect(testMocks.secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'billmanager_access_token',
      'access-token-2',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(testMocks.secureStoreMock.setItemAsync).toHaveBeenCalledWith(
      'billmanager_refresh_token',
      'refresh-token-2',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
  });

  it('invokes auth error handler when interceptor cannot refresh on 401', async () => {
    testMocks.axiosMock.post.mockRejectedValueOnce(new Error('refresh failed'));

    const api = new BillManagerApi();
    const onAuthError = vi.fn();
    api.setAuthErrorHandler(onAuthError);
    (api as unknown as { refreshToken: string | null }).refreshToken = 'expired-refresh';

    expect(testMocks.state.responseErrorHandler).toBeDefined();
    await expect(testMocks.state.responseErrorHandler!({
      response: { status: 401 },
      config: {},
    })).rejects.toBeTruthy();

    expect(onAuthError).toHaveBeenCalledTimes(1);
  });
});
