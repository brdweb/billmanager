import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { ApiResponse, LoginResponse, Bill, Payment, SyncResponse, SyncPushRequest, SyncPushResponse, DeviceInfo, MonthlyStats, DatabaseInfo, AdminUser, Invitation, DatabaseWithAccess, User, SubscriptionStatus, BillingUsage } from '../types';

// Storage keys
const ACCESS_TOKEN_KEY = 'billmanager_access_token';
const REFRESH_TOKEN_KEY = 'billmanager_refresh_token';
const CURRENT_DATABASE_KEY = 'billmanager_current_database';
const LAST_SYNC_KEY = 'billmanager_last_sync';

// API Configuration
// For local development, use your machine's IP (not localhost)
// Physical device (Expo Go): use your computer's local IP
// Android emulator: 10.0.2.2 maps to host machine
const API_BASE_URL = __DEV__
  ? 'http://192.168.2.48:5001/api/v2'  // Your local IP for physical device testing
  : 'https://app.billmanager.app/api/v2';

class BillManagerApi {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private currentDatabase: string | null = null;
  private onAuthError: (() => void) | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor - add auth headers
    this.client.interceptors.request.use(
      async (config) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        if (this.currentDatabase) {
          config.headers['X-Database'] = this.currentDatabase;
        }
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
        if (error.response?.status === 401 && !originalRequest._retry && this.refreshToken) {
          originalRequest._retry = true;

          try {
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
              originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
              return this.client(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, trigger logout
            this.onAuthError?.();
          }
        }

        return Promise.reject(error);
      }
    );
  }

  // Initialize from stored tokens
  async initialize(): Promise<boolean> {
    try {
      this.accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      this.refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      this.currentDatabase = await SecureStore.getItemAsync(CURRENT_DATABASE_KEY);
      return !!this.accessToken;
    } catch (error) {
      console.error('Failed to initialize API client:', error);
      return false;
    }
  }

  // Set callback for auth errors (triggers logout in app)
  setAuthErrorHandler(handler: () => void) {
    this.onAuthError = handler;
  }

  // Get current base URL (for debugging)
  getBaseUrl(): string {
    return this.client.defaults.baseURL || API_BASE_URL;
  }

  // Set base URL (for self-hosted servers)
  setBaseUrl(url: string) {
    this.client.defaults.baseURL = url;
  }

  // ============ Auth ============

  async login(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    try {
      const response = await this.client.post<ApiResponse<LoginResponse>>('/auth/login', {
        username,
        password,
      });

      if (response.data.success && response.data.data) {
        const { access_token, refresh_token } = response.data.data;
        this.accessToken = access_token;
        this.refreshToken = refresh_token;

        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access_token);
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh_token);

        // Set first database as default if available
        if (response.data.data.databases?.length > 0) {
          await this.setCurrentDatabase(response.data.data.databases[0].name);
        }
      }

      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.refreshToken) {
        await this.client.post('/auth/logout', { refresh_token: this.refreshToken });
      }
    } catch (error) {
      // Ignore logout errors
    } finally {
      await this.clearTokens();
    }
  }

  async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    try {
      const response = await axios.post<ApiResponse<{ access_token: string }>>(
        `${API_BASE_URL}/auth/refresh`,
        { refresh_token: this.refreshToken }
      );

      if (response.data.success && response.data.data) {
        this.accessToken = response.data.data.access_token;
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, this.accessToken);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  private async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.currentDatabase = null;
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(CURRENT_DATABASE_KEY);
    await SecureStore.deleteItemAsync(LAST_SYNC_KEY);
  }

  // ============ Database Selection ============

  async setCurrentDatabase(dbName: string): Promise<void> {
    this.currentDatabase = dbName;
    await SecureStore.setItemAsync(CURRENT_DATABASE_KEY, dbName);
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
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
      const response = await axios.get(`${API_BASE_URL}/config`);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ============ Password Reset ============

  async forgotPassword(email: string): Promise<ApiResponse<{ message: string }>> {
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/forgot-password`, { email });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getAccounts(): Promise<ApiResponse<DatabaseInfo[]>> {
    try {
      const response = await this.client.get<ApiResponse<{ databases: DatabaseInfo[] }>>('/me');
      if (response.data.success && response.data.data) {
        return { success: true, data: response.data.data.databases };
      }
      return response.data as any;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getUserInfo(): Promise<ApiResponse<{ user: User; databases: DatabaseInfo[] }>> {
    try {
      const response = await this.client.get<ApiResponse<{ user: User; databases: DatabaseInfo[] }>>('/me');
      return response.data;
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

  // ============ Sync ============

  async syncFull(): Promise<ApiResponse<SyncResponse>> {
    try {
      const response = await this.client.get<ApiResponse<SyncResponse>>('/sync/full');
      if (response.data.success && response.data.data) {
        await SecureStore.setItemAsync(LAST_SYNC_KEY, response.data.data.server_time);
      }
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async syncDelta(since?: string): Promise<ApiResponse<SyncResponse>> {
    try {
      const lastSync = since || await SecureStore.getItemAsync(LAST_SYNC_KEY);
      if (!lastSync) {
        return this.syncFull();
      }

      const response = await this.client.get<ApiResponse<SyncResponse>>('/sync', {
        params: { since: lastSync },
      });

      if (response.data.success && response.data.data) {
        await SecureStore.setItemAsync(LAST_SYNC_KEY, response.data.data.server_time);
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

  async createDatabase(name: string, displayName: string): Promise<ApiResponse<{ id: number }>> {
    try {
      const response = await this.client.post<ApiResponse<{ id: number }>>('/databases', {
        name,
        display_name: displayName,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateDatabase(databaseId: number, displayName: string): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.put<ApiResponse<void>>(`/databases/${databaseId}`, {
        display_name: displayName,
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

  // ============ Helpers ============

  private handleError(error: unknown): ApiResponse<any> {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ApiResponse<any>>;
      if (axiosError.response?.data) {
        return axiosError.response.data;
      }
      return {
        success: false,
        error: axiosError.message || 'Network error',
      };
    }
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }
}

// Singleton instance
export const api = new BillManagerApi();
export default api;
