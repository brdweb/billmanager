import axios, { AxiosError } from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { TokenStorage } from '../utils/tokenStorage';

const api = axios.create({
  baseURL: '/api/v2',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
});

// Request interceptor - add JWT token and database header
api.interceptors.request.use(
  (config) => {
    const accessToken = TokenStorage.getAccessToken();
    const currentDb = TokenStorage.getCurrentDatabase();

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    if (currentDb) {
      config.headers['X-Database'] = currentDb;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Custom error class for API errors with user-friendly messages
export class ApiError extends Error {
  public statusCode: number;
  public originalError: AxiosError;

  constructor(message: string, statusCode: number, originalError: AxiosError) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

// Map HTTP status codes to user-friendly messages
function getErrorMessage(error: AxiosError): string {
  const status = error.response?.status;
  const serverMessage = (error.response?.data as { error?: string })?.error;

  // Return server message if available
  if (serverMessage) {
    return serverMessage;
  }

  // Network errors
  if (error.code === 'ECONNABORTED') {
    return 'Request timed out. Please check your connection and try again.';
  }
  if (!error.response) {
    return 'Unable to connect to server. Please check your internet connection.';
  }

  // HTTP status code based messages
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
      return 'Your session has expired. Please log in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 405:
      return 'This operation is not allowed. Please contact support if this persists.';
    case 409:
      return 'This action conflicts with existing data.';
    case 422:
      return 'The provided data is invalid. Please check your input.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Server error. Please try again later.';
    case 502:
    case 503:
    case 504:
      return 'Service temporarily unavailable. Please try again later.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

// Response interceptor - handle errors and automatic token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Log errors in development
    if (import.meta.env.DEV) {
      console.error('API Error:', error.config?.method?.toUpperCase(), error.config?.url, error.response?.status);
    }

    // Automatic token refresh on 401
    if (error.response?.status === 401 && !originalRequest?._retry) {
      originalRequest._retry = true;

      const refreshToken = TokenStorage.getRefreshToken();
      if (refreshToken) {
        try {
          const response = await axios.post('/api/v2/auth/refresh', {
            refresh_token: refreshToken,
          });

          if (response.data.success && response.data.data?.access_token) {
            // Update access token, keep same refresh token
            TokenStorage.setTokens(response.data.data.access_token, refreshToken);

            // Retry original request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${response.data.data.access_token}`;
            }
            return api(originalRequest);
          }
        } catch (refreshError) {
          // Token refresh failed - clear tokens and redirect to login
          TokenStorage.clearTokens();
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }
    }

    // Return user-friendly error
    const message = getErrorMessage(error);
    const statusCode = error.response?.status || 0;
    return Promise.reject(new ApiError(message, statusCode, error));
  }
);

// Generic API response wrapper for v2 endpoints
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Helper to unwrap v2 API responses
const unwrap = async <T>(promise: Promise<{ data: ApiResponse<T> }>) => {
  const response = await promise;
  const apiResponse = response.data;

  if (!apiResponse.success) {
    throw new Error(apiResponse.error || 'API request failed');
  }

  return apiResponse.data as T;
};

// Types
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  email?: string | null;
  is_account_owner?: boolean;
}

export interface Database {
  id?: number;
  name: string;
  display_name: string;
  description: string;
}

export interface FrequencyConfig {
  dates?: number[];
  days?: number[];
}

export interface Bill {
  id: number;
  name: string;
  amount: number | null;
  varies: boolean;
  frequency: 'weekly' | 'bi-weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  frequency_type: 'simple' | 'specific_dates' | 'multiple_weekly';
  frequency_config: string;
  next_due: string;
  auto_payment: boolean;
  paid: boolean;
  archived: boolean;
  icon: string;
  type: 'expense' | 'deposit';
  account: string | null;
  created_at: string;
  avg_amount?: number;
  is_shared: boolean;
  share_count?: number;  // Number of people this bill is shared with (for owned bills)
  share_info?: {
    share_id: number;
    owner_name: string;
    my_portion: number | null;
    my_portion_paid: boolean;
    my_portion_paid_date: string | null;
  };
  database_id?: number;  // Database/bucket the bill belongs to
  database_name?: string;  // Display name of the database/bucket
}

export interface Payment {
  id: number;
  amount: number;
  payment_date: string;
}

export interface PaymentWithBill extends Payment {
  bill_name: string;
  bill_icon: string;
  bill_type?: 'expense' | 'deposit' | 'bill';  // Effective type for categorization
  original_bill_type?: string;  // Original bill type
  is_share_payment?: boolean;  // True if this is a shared bill payment
  is_received_payment?: boolean;  // True if this is money received from a sharee (owner view)
  notes?: string;
  database_id?: number;  // Database/bucket the payment's bill belongs to
  database_name?: string;  // Display name of the database/bucket
}

export interface MonthlyBillPayment {
  month: string;
  total: number;
  count: number;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
  databases: Database[];
  password_change_required?: boolean;
  user_id?: number;
  change_token?: string;
  is_account_owner?: boolean;
  warning?: string;
}

export interface MeResponse {
  user: User;
  databases: Database[];
}

// Auth API
export const login = async (username: string, password: string): Promise<LoginResponse> => {
  const response = await unwrap(api.post<ApiResponse<LoginResponse>>('/auth/login', { username, password }));

  // Store JWT tokens in localStorage
  if (response.access_token && response.refresh_token) {
    TokenStorage.setTokens(response.access_token, response.refresh_token);

    // Set first database as default
    if (response.databases && response.databases.length > 0) {
      TokenStorage.setCurrentDatabase(response.databases[0].name);
    }
  }

  return response;
};

export const logout = async (): Promise<void> => {
  try {
    const refreshToken = TokenStorage.getRefreshToken();
    if (refreshToken) {
      await api.post('/auth/logout', { refresh_token: refreshToken });
    }
  } finally {
    TokenStorage.clearTokens();
  }
};

export const getMe = () =>
  unwrap(api.get<ApiResponse<MeResponse>>('/me'));

export const changePassword = (
  user_id: number,
  change_token: string,
  current_password: string,
  new_password: string
) =>
  unwrap(api.post<ApiResponse<{ message: string; role: string; databases: Database[] }>>('/auth/change-password', {
    user_id,
    change_token,
    current_password,
    new_password,
  }));

// Database API - selectDatabase removed, database selection is now client-side only via TokenStorage

export const getDatabases = () =>
  unwrap(api.get<ApiResponse<Database[]>>('/databases'));

export const createDatabase = (name: string, display_name: string, description: string) =>
  unwrap(api.post<ApiResponse<void>>('/databases', { name, display_name, description }));

export const deleteDatabase = (dbId: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/databases/${dbId}`));

export const updateDatabase = (dbId: number, display_name: string, description: string) =>
  unwrap(api.put<ApiResponse<Database>>(`/databases/${dbId}`, { display_name, description }));

export const getDatabaseAccess = (dbId: number) =>
  unwrap(api.get<ApiResponse<User[]>>(`/databases/${dbId}/access`));

export const grantDatabaseAccess = (dbId: number, userId: number) =>
  unwrap(api.post<ApiResponse<void>>(`/databases/${dbId}/access`, { user_id: userId }));

export const revokeDatabaseAccess = (dbId: number, userId: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/databases/${dbId}/access/${userId}`));

// User API
export const getUsers = () =>
  unwrap(api.get<ApiResponse<User[]>>('/users'));

export const addUser = (
  username: string,
  password: string,
  role: string,
  database_ids: number[]
) =>
  unwrap(api.post<ApiResponse<void>>('/users', { username, password, role, database_ids }));

export const deleteUser = (userId: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/users/${userId}`));

export const updateUser = (userId: number, data: { email?: string | null; role?: 'admin' | 'user' }) =>
  unwrap(api.put<ApiResponse<User>>(`/users/${userId}`, data));

export const getUserDatabases = (userId: number) =>
  unwrap(api.get<ApiResponse<Database[]>>(`/users/${userId}/databases`));

// User Invitations API
export interface UserInvite {
  id: number;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

export const inviteUser = (email: string, role: string, database_ids: number[]) =>
  unwrap(api.post<ApiResponse<{ message: string; id: number }>>('/invitations', { email, role, database_ids }));

export const getInvites = () =>
  unwrap(api.get<ApiResponse<UserInvite[]>>('/invitations'));

export const cancelInvite = (inviteId: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/invitations/${inviteId}`));

// Public invitation endpoints (v1 only - no auth required)
// These use axios directly since they're not in v2 API yet
export const getInviteInfo = async (token: string) => {
  const response = await axios.get<ApiResponse<{ email: string; invited_by: string; expires_at: string }>>(
    `/invite-info?token=${encodeURIComponent(token)}`
  );
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to get invitation info');
  }
  return response.data.data!;
};

export const acceptInvite = async (token: string, username: string, password: string) => {
  const response = await axios.post<ApiResponse<{ message: string; username: string }>>(
    '/accept-invite',
    { token, username, password }
  );
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to accept invitation');
  }
  return response.data.data!;
};

// Bills API
export const getBills = (includeArchived = false, type?: 'expense' | 'deposit') => {
  let url = `/bills${includeArchived ? '?include_archived=true' : ''}`;
  if (type) {
    url += includeArchived ? `&type=${type}` : `?type=${type}`;
  }
  return unwrap(api.get<ApiResponse<Bill[]>>(url));
};

export const addBill = (bill: Partial<Bill>) =>
  unwrap(api.post<ApiResponse<void>>('/bills', bill));

export const getAccounts = () =>
  unwrap(api.get<ApiResponse<string[]>>('/accounts'));

export const updateBill = (id: number, bill: Partial<Bill>) =>
  unwrap(api.put<ApiResponse<void>>(`/bills/${id}`, bill));

export const archiveBill = (id: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/bills/${id}`));

export const unarchiveBill = (id: number) =>
  unwrap(api.post<ApiResponse<void>>(`/bills/${id}/unarchive`));

export const deleteBillPermanent = (id: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/bills/${id}/permanent`));

export const payBill = (id: number, amount: number, advance_due: boolean) =>
  unwrap(api.post<ApiResponse<void>>(`/bills/${id}/pay`, { amount, advance_due }));

// Payments API
export const getPayments = (billId: number) =>
  unwrap(api.get<ApiResponse<Payment[]>>(`/bills/${billId}/payments`));

export const updatePayment = (id: number, amount: number, payment_date: string) =>
  unwrap(api.put<ApiResponse<void>>(`/payments/${id}`, { amount, payment_date }));

export const deletePayment = (id: number) =>
  unwrap(api.delete<ApiResponse<void>>(`/payments/${id}`));

export const getMonthlyPayments = () =>
  unwrap(api.get<ApiResponse<Record<string, {deposits: number, expenses: number}>>>('/stats/monthly'));

export interface AccountStats {
  account: string;
  expenses: number;
  deposits: number;
  total: number;
}

export const getStatsByAccount = () =>
  unwrap(api.get<ApiResponse<AccountStats[]>>('/stats/by-account'));

export interface YearlyStats {
  [year: string]: {
    expenses: number;
    deposits: number;
  };
}

export const getStatsYearly = () =>
  unwrap(api.get<ApiResponse<YearlyStats>>('/stats/yearly'));

export interface MonthlyComparison {
  current_year: number;
  last_year: number;
  months: Array<{
    month: string;
    current_year_expenses: number;
    current_year_deposits: number;
    last_year_expenses: number;
    last_year_deposits: number;
  }>;
}

export const getMonthlyComparison = () =>
  unwrap(api.get<ApiResponse<MonthlyComparison>>('/stats/monthly-comparison'));

export const getAllPayments = () =>
  unwrap(api.get<ApiResponse<PaymentWithBill[]>>('/payments'));

// Note: This endpoint has no v2 equivalent - may need to filter client-side or add v2 endpoint
export const getBillMonthlyPayments = (billName: string) =>
  unwrap(api.get<ApiResponse<MonthlyBillPayment[]>>(`/payments/bill/${encodeURIComponent(billName)}/monthly`));

// Auto-payment API
export const processAutoPayments = () =>
  unwrap(api.post<ApiResponse<void>>('/process-auto-payments'));

// Version API
export const getVersion = () =>
  unwrap(api.get<ApiResponse<{ version: string; features: string[] }>>('/version'));

// App Config API (v2)
export interface AppConfig {
  deployment_mode: 'saas' | 'self-hosted';
  billing_enabled: boolean;
  registration_enabled: boolean;
  email_enabled: boolean;
  email_verification_required: boolean;
  oauth_providers?: { id: string; display_name: string; icon: string }[];
  twofa_enabled?: boolean;
  passkeys_enabled?: boolean;
}

export interface AppConfigResponse {
  success: boolean;
  data: AppConfig;
}

export const getAppConfig = async () => {
  const response = await unwrap(api.get<ApiResponse<AppConfig>>('/config'));
  return response;
};

// Registration & Auth API (v2)
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export const register = (data: RegisterRequest) =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/auth/register', data));

export const verifyEmail = (token: string) =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/auth/verify-email', { token }));

export const resendVerification = (email: string) =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/auth/resend-verification', { email }));

export const forgotPassword = (email: string) =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/auth/forgot-password', { email }));

export const resetPassword = (token: string, password: string) =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/auth/reset-password', { token, password }));

// Billing API (v2)
export interface BillingConfig {
  publishable_key: string;
  enabled: boolean;
}

export interface TierLimits {
  bills: number;
  users: number;
  bill_groups: number;
  export: boolean;
  full_analytics: boolean;
  priority_support: boolean;
}

export interface SubscriptionStatus {
  has_subscription: boolean;
  status?: string;
  plan?: string;
  tier?: string;
  effective_tier?: string;
  billing_interval?: string;
  limits?: TierLimits;
  is_active?: boolean;
  is_trialing?: boolean;
  is_trial_expired?: boolean;
  trial_ends_at?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  in_trial?: boolean;
  trial_days_remaining?: number;
  days_until_renewal?: number;
}

export interface UsageInfo {
  used: number;
  limit: number;
  unlimited: boolean;
}

export interface BillingUsage {
  tier: string;
  is_saas: boolean;
  limits: TierLimits;
  usage: {
    bills: UsageInfo;
    bill_groups: UsageInfo;
  };
}

export interface CheckoutResponse {
  success: boolean;
  url?: string;
  error?: string;
}

export const getBillingConfig = () =>
  unwrap(api.get<ApiResponse<BillingConfig>>('/billing/config'));

export const getSubscriptionStatus = async () => {
  const response = await unwrap(api.get<ApiResponse<SubscriptionStatus>>('/billing/status'));
  return response;
};

export const getBillingUsage = async () => {
  const response = await unwrap(api.get<ApiResponse<BillingUsage>>('/billing/usage'));
  return response;
};

export const createCheckoutSession = (tier: string = 'basic', interval: string = 'monthly') =>
  unwrap(api.post<ApiResponse<CheckoutResponse>>('/billing/create-checkout', { tier, interval }));

export const createPortalSession = () =>
  unwrap(api.post<ApiResponse<CheckoutResponse>>('/billing/portal'));

// Telemetry API (v1 - session auth)
export interface TelemetryNoticeResponse {
  success: boolean;
  data: {
    show_notice: boolean;
    opted_out?: boolean;
    notice_shown_at?: string;
    reason?: string;
    telemetry_enabled?: boolean;
    deployment_mode?: string;
  };
}

export const getTelemetryNotice = async () => {
  // unwrap() already extracts the data field from ApiResponse
  return await unwrap(api.get<ApiResponse<TelemetryNoticeResponse['data']>>('/telemetry/notice'));
};

export const acceptTelemetry = () =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/telemetry/accept'));

export const optOutTelemetry = () =>
  unwrap(api.post<ApiResponse<AuthResponse>>('/telemetry/opt-out'));

// Bill Sharing API
export interface BillShare {
  id: number;
  shared_with: string;
  identifier_type: 'username' | 'email';
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  created_at: string | null;
  accepted_at: string | null;
  recipient_paid_date: string | null;
}

export interface SharedBill {
  share_id: number;
  bill: {
    id: number;
    name: string;
    amount: number | null;
    next_due: string;
    icon: string;
    type: 'expense' | 'deposit';
    frequency: string;
    is_variable: boolean;
    auto_pay: boolean;
  };
  owner: string;
  owner_id: number;
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  my_portion: number | null;
  last_payment: {
    id: number;
    amount: number;
    date: string;
    notes: string | null;
  } | null;
  created_at: string | null;
}

export interface PendingShare {
  share_id: number;
  bill_name: string;
  bill_amount: number | null;
  owner: string;
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  my_portion: number | null;
  expires_at: string | null;
}

export interface ShareBillRequest {
  identifier: string;
  split_type?: 'percentage' | 'fixed' | 'equal' | null;
  split_value?: number | null;
}

export interface UserSearchResult {
  id: number;
  username: string;
}

// Share a bill with another user
export const shareBill = (billId: number, data: ShareBillRequest) =>
  unwrap(api.post<ApiResponse<{ share_id: number; status: string; message: string }>>(`/bills/${billId}/share`, data));

// Get all shares for a bill (owner view)
export const getBillShares = (billId: number) =>
  unwrap(api.get<ApiResponse<BillShare[]>>(`/bills/${billId}/shares`));

// Revoke a share
export const revokeShare = (shareId: number) =>
  unwrap(api.delete<ApiResponse<{ message: string }>>(`/shares/${shareId}`));

// Update share split configuration
export const updateShare = (shareId: number, data: { split_type?: string | null; split_value?: number | null }) =>
  unwrap(api.put<ApiResponse<{ message: string }>>(`/shares/${shareId}`, data));

// Get bills shared with current user
export const getSharedBills = () =>
  unwrap(api.get<ApiResponse<SharedBill[]>>('/shared-bills'));

// Get pending share invitations
export const getPendingShares = () =>
  unwrap(api.get<ApiResponse<PendingShare[]>>('/shared-bills/pending'));

// Accept a share invitation
export const acceptShare = (shareId: number) =>
  unwrap(api.post<ApiResponse<{ message: string }>>(`/shares/${shareId}/accept`));

// Decline a share invitation
export const declineShare = (shareId: number) =>
  unwrap(api.post<ApiResponse<{ message: string }>>(`/shares/${shareId}/decline`));

// Leave a shared bill
export const leaveShare = (shareId: number) =>
  unwrap(api.post<ApiResponse<{ message: string }>>(`/shares/${shareId}/leave`));

// Mark recipient's portion of shared bill as paid (toggle)
export const markSharePaid = (shareId: number) =>
  unwrap(api.post<ApiResponse<{ message: string; recipient_paid_date: string | null }>>(`/shares/${shareId}/mark-paid`));

// Search users for sharing
export const searchUsers = (query: string) =>
  unwrap(api.get<ApiResponse<UserSearchResult[]>>(`/users/search?q=${encodeURIComponent(query)}`));

// Get share invitation details by token (public)
export const getShareInviteDetails = (token: string) =>
  unwrap(api.get<ApiResponse<{
    bill_name: string;
    bill_amount: number;
    owner_username: string;
    shared_with_email: string;
    split_type: string | null;
    split_value: number | null;
    my_portion: number | null;
  }>>(`/share-info?token=${encodeURIComponent(token)}`));

// Accept share invitation by token (requires login)
export const acceptShareByToken = (token: string) =>
  unwrap(api.post<ApiResponse<{ message: string; share_id: number }>>('/share/accept-by-token', { token }));

// ============ OIDC / OAuth API ============

export interface OAuthProvider {
  id: string;
  display_name: string;
  icon: string;
}

export interface OAuthAccount {
  id: number;
  provider: string;
  provider_email: string | null;
  created_at: string | null;
}

export const getOAuthProviders = () =>
  unwrap(api.get<ApiResponse<OAuthProvider[]>>('/auth/oauth/providers'));

export const getOAuthAuthorizeUrl = (provider: string) =>
  unwrap(api.get<ApiResponse<{ auth_url: string; state: string }>>(`/auth/oauth/${provider}/authorize`));

export interface OAuthCallbackResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: User & { is_new_user?: boolean };
  databases: Database[];
}

export const oauthCallback = async (provider: string, code: string, state: string): Promise<OAuthCallbackResponse> => {
  const response = await api.post<ApiResponse<OAuthCallbackResponse>>(
    `/auth/oauth/${provider}/callback`,
    { code, state }
  );

  // Handle 2FA required (403 with twofa_required)
  const apiResponse = response.data;
  if (!apiResponse.success && (apiResponse as unknown as Record<string, unknown>).twofa_required) {
    throw new TwoFARequiredError(apiResponse as unknown as TwoFARequiredResponse);
  }

  if (!apiResponse.success) {
    throw new Error(apiResponse.error || 'OAuth callback failed');
  }

  const result = apiResponse.data as OAuthCallbackResponse;

  // Store tokens
  if (result.access_token && result.refresh_token) {
    TokenStorage.setTokens(result.access_token, result.refresh_token);
    if (result.databases?.length > 0) {
      TokenStorage.setCurrentDatabase(result.databases[0].name);
    }
  }

  return result;
};

export const getOAuthAccounts = () =>
  unwrap(api.get<ApiResponse<OAuthAccount[]>>('/auth/oauth/accounts'));

export const unlinkOAuthProvider = (provider: string) =>
  unwrap(api.delete<ApiResponse<{ message: string }>>(`/auth/oauth/${provider}`));

// ============ Two-Factor Authentication API ============

export interface TwoFAStatus {
  enabled: boolean;
  email_otp_enabled: boolean;
  passkey_enabled: boolean;
  passkeys: Array<{
    id: number;
    device_name: string;
    created_at: string | null;
    last_used_at: string | null;
  }>;
  has_recovery_codes: boolean;
}

export interface TwoFARequiredResponse {
  success: false;
  twofa_required: true;
  twofa_session_token: string;
  twofa_methods: string[];
}

export class TwoFARequiredError extends Error {
  public response: TwoFARequiredResponse;
  constructor(response: TwoFARequiredResponse) {
    super('2FA verification required');
    this.name = 'TwoFARequiredError';
    this.response = response;
  }
}

export const get2FAStatus = () =>
  unwrap(api.get<ApiResponse<TwoFAStatus>>('/auth/2fa/status'));

export const setup2FAEmail = () =>
  unwrap(api.post<ApiResponse<{ message: string; setup_token: string }>>('/auth/2fa/setup/email'));

export const confirm2FAEmail = (setup_token: string, code: string) =>
  unwrap(api.post<ApiResponse<{ message: string; recovery_codes: string[] | null }>>('/auth/2fa/setup/email/confirm', { setup_token, code }));

export const getRecoveryCodes = () =>
  unwrap(api.get<ApiResponse<{ recovery_codes: string[] }>>('/auth/2fa/recovery-codes'));

export const getPasskeyRegistrationOptions = () =>
  unwrap(api.post<ApiResponse<{ options: Record<string, unknown>; registration_token: string }>>('/auth/2fa/setup/passkey/options'));

export const registerPasskey = (registration_token: string, credential: Record<string, unknown>, device_name: string) =>
  unwrap(api.post<ApiResponse<{ message: string; credential_id: number; device_name: string; recovery_codes: string[] | null }>>('/auth/2fa/setup/passkey/register', { registration_token, credential, device_name }));

export const listPasskeys = () =>
  unwrap(api.get<ApiResponse<Array<{ id: number; device_name: string; created_at: string | null; last_used_at: string | null }>>>('/auth/2fa/setup/passkeys'));

export const deletePasskey = (passkeyId: number) =>
  unwrap(api.delete<ApiResponse<{ message: string }>>(`/auth/2fa/setup/passkey/${passkeyId}`));

export const disable2FA = (password: string) =>
  unwrap(api.post<ApiResponse<{ message: string }>>('/auth/2fa/disable', { password }));

export const request2FAChallenge = (session_token: string, method: string) =>
  unwrap(api.post<ApiResponse<{ message: string }>>('/auth/2fa/challenge', { session_token, method }));

export const getPasskeyAuthOptions = (session_token: string) =>
  unwrap(api.post<ApiResponse<{ options: Record<string, unknown> }>>('/auth/2fa/verify/passkey/options', { session_token }));

export interface TwoFAVerifyResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: User;
  databases: Database[];
}

export const verify2FA = async (session_token: string, method: string, payload: Record<string, unknown>): Promise<TwoFAVerifyResponse> => {
  const response = await unwrap(
    api.post<ApiResponse<TwoFAVerifyResponse>>('/auth/2fa/verify', {
      session_token,
      method,
      ...payload,
    })
  );

  // Store tokens
  if (response.access_token && response.refresh_token) {
    TokenStorage.setTokens(response.access_token, response.refresh_token);
    if (response.databases?.length > 0) {
      TokenStorage.setCurrentDatabase(response.databases[0].name);
    }
  }

  return response;
};

// Override login to handle 2FA required response
const originalLogin = login;
export { originalLogin };

// Wrap the existing login to detect 2FA
export const loginWith2FA = async (username: string, password: string): Promise<LoginResponse | TwoFARequiredResponse> => {
  try {
    const response = await api.post<ApiResponse<LoginResponse>>('/auth/login', { username, password });
    const apiResponse = response.data;

    // Check for 2FA required (comes as 403 with specific fields)
    if (!apiResponse.success && (apiResponse as unknown as Record<string, unknown>).twofa_required) {
      return apiResponse as unknown as TwoFARequiredResponse;
    }

    if (!apiResponse.success) {
      throw new Error(apiResponse.error || 'Login failed');
    }

    const result = apiResponse.data as LoginResponse;

    // Store tokens
    if (result.access_token && result.refresh_token) {
      TokenStorage.setTokens(result.access_token, result.refresh_token);
      if (result.databases?.length > 0) {
        TokenStorage.setCurrentDatabase(result.databases[0].name);
      }
    }

    return result;
  } catch (error: unknown) {
    // Axios interceptor converts 403 to error, check if it's a 2FA response
    const axiosErr = error as { originalError?: { response?: { data?: Record<string, unknown> } } };
    const responseData = axiosErr.originalError?.response?.data;
    if (responseData && responseData.twofa_required) {
      return responseData as unknown as TwoFARequiredResponse;
    }
    throw error;
  }
};

export default api;
