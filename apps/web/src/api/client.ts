import axios, { AxiosError } from 'axios';

const api = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
  withCredentials: true,
});

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

// Only log errors in development, never log request data (may contain passwords)
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (import.meta.env.DEV) {
      console.error('API Error:', error.config?.method?.toUpperCase(), error.config?.url, error.response?.status);
    }
    const message = getErrorMessage(error);
    const statusCode = error.response?.status || 0;
    return Promise.reject(new ApiError(message, statusCode, error));
  }
);

// Helper to unwrap axios responses for consistency with mobile client
const unwrap = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

// Types
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  email?: string | null;
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
}

export interface Payment {
  id: number;
  amount: number;
  payment_date: string;
}

export interface PaymentWithBill extends Payment {
  bill_name: string;
  bill_icon: string;
}

export interface MonthlyBillPayment {
  month: string;
  total: number;
  count: number;
}

export interface LoginResponse {
  message: string;
  role: 'admin' | 'user';
  password_change_required?: boolean;
  user_id?: number;
  change_token?: string;
  databases?: Database[];
  is_account_owner?: boolean;
  warning?: string;
}

export interface MeResponse {
  role: 'admin' | 'user';
  current_db: string | null;
  databases: Database[];
  is_account_owner?: boolean;
}

// Auth API
export const login = (username: string, password: string) =>
  unwrap(api.post<LoginResponse>('/login', { username, password }));

export const logout = () =>
  unwrap(api.post('/logout'));

export const getMe = () =>
  unwrap(api.get<MeResponse>('/me'));

export const changePassword = (
  user_id: number,
  change_token: string,
  current_password: string,
  new_password: string
) =>
  unwrap(api.post<{ message: string; role: string; databases: Database[] }>('/change-password', {
    user_id,
    change_token,
    current_password,
    new_password,
  }));

// Database API
export const selectDatabase = (dbName: string) =>
  unwrap(api.post(`/select-db/${dbName}`));

export const getDatabases = () =>
  unwrap(api.get<Database[]>('/databases'));

export const createDatabase = (name: string, display_name: string, description: string) =>
  unwrap(api.post('/databases', { name, display_name, description }));

export const deleteDatabase = (dbId: number) =>
  unwrap(api.delete(`/databases/${dbId}`));

export const updateDatabase = (dbId: number, display_name: string, description: string) =>
  unwrap(api.put<Database>(`/databases/${dbId}`, { display_name, description }));

export const getDatabaseAccess = (dbId: number) =>
  unwrap(api.get<User[]>(`/databases/${dbId}/access`));

export const grantDatabaseAccess = (dbId: number, userId: number) =>
  unwrap(api.post(`/databases/${dbId}/access`, { user_id: userId }));

export const revokeDatabaseAccess = (dbId: number, userId: number) =>
  unwrap(api.delete(`/databases/${dbId}/access/${userId}`));

// User API
export const getUsers = () =>
  unwrap(api.get<User[]>('/users'));

export const addUser = (
  username: string,
  password: string,
  role: string,
  database_ids: number[]
) =>
  unwrap(api.post('/users', { username, password, role, database_ids }));

export const deleteUser = (userId: number) =>
  unwrap(api.delete(`/users/${userId}`));

export const updateUser = (userId: number, data: { email?: string | null; role?: 'admin' | 'user' }) =>
  unwrap(api.put<User>(`/users/${userId}`, data));

export const getUserDatabases = (userId: number) =>
  unwrap(api.get<Database[]>(`/users/${userId}/databases`));

// User Invitations API
export interface UserInvite {
  id: number;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

export const inviteUser = (email: string, role: string, database_ids: number[]) =>
  unwrap(api.post<{ message: string; id: number }>('/users/invite', { email, role, database_ids }));

export const getInvites = () =>
  unwrap(api.get<UserInvite[]>('/users/invites'));

export const cancelInvite = (inviteId: number) =>
  unwrap(api.delete(`/users/invites/${inviteId}`));

export const getInviteInfo = (token: string) =>
  unwrap(api.get<{ email: string; invited_by: string; expires_at: string }>(`/invite-info?token=${token}`));

export const acceptInvite = (token: string, username: string, password: string) =>
  unwrap(api.post<{ message: string; username: string }>('/accept-invite', { token, username, password }));

// Bills API
export const getBills = (includeArchived = false, type?: 'expense' | 'deposit') => {
  let url = `/bills${includeArchived ? '?include_archived=true' : ''}`;
  if (type) {
    url += includeArchived ? `&type=${type}` : `?type=${type}`;
  }
  return unwrap(api.get<Bill[]>(url));
};

export const addBill = (bill: Partial<Bill>) =>
  unwrap(api.post('/bills', bill));

export const getAccounts = () =>
  unwrap(api.get<string[]>('/api/accounts'));

export const updateBill = (id: number, bill: Partial<Bill>) =>
  unwrap(api.put(`/bills/${id}`, bill));

export const archiveBill = (id: number) =>
  unwrap(api.delete(`/bills/${id}`));

export const unarchiveBill = (id: number) =>
  unwrap(api.post(`/bills/${id}/unarchive`));

export const deleteBillPermanent = (id: number) =>
  unwrap(api.delete(`/bills/${id}/permanent`));

export const payBill = (id: number, amount: number, advance_due: boolean) =>
  unwrap(api.post(`/bills/${id}/pay`, { amount, advance_due }));

// Payments API
export const getPayments = (billId: number) =>
  unwrap(api.get<Payment[]>(`/bills/${billId}/payments`));

export const updatePayment = (id: number, amount: number, payment_date: string) =>
  unwrap(api.put(`/payments/${id}`, { amount, payment_date }));

export const deletePayment = (id: number) =>
  unwrap(api.delete(`/payments/${id}`));

export const getMonthlyPayments = () =>
  unwrap(api.get<Record<string, number>>('/api/payments/monthly'));

export const getAllPayments = () =>
  unwrap(api.get<PaymentWithBill[]>('/api/payments/all'));

export const getBillMonthlyPayments = (billName: string) =>
  unwrap(api.get<MonthlyBillPayment[]>(`/api/payments/bill/${encodeURIComponent(billName)}/monthly`));

// Auto-payment API
export const processAutoPayments = () =>
  unwrap(api.post('/api/process-auto-payments'));

// Version API
export const getVersion = () =>
  unwrap(api.get<{ version: string; features: string[] }>('/api/version'));

// App Config API (v2)
export interface AppConfig {
  deployment_mode: 'saas' | 'self-hosted';
  billing_enabled: boolean;
  registration_enabled: boolean;
  email_enabled: boolean;
  email_verification_required: boolean;
}

export interface AppConfigResponse {
  success: boolean;
  data: AppConfig;
}

export const getAppConfig = async () => {
  const response = await unwrap(api.get<AppConfigResponse>('/api/v2/config'));
  return response.data;
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
  unwrap(api.post<AuthResponse>('/api/v2/auth/register', data));

export const verifyEmail = (token: string) =>
  unwrap(api.post<AuthResponse>('/api/v2/auth/verify-email', { token }));

export const resendVerification = (email: string) =>
  unwrap(api.post<AuthResponse>('/api/v2/auth/resend-verification', { email }));

export const forgotPassword = (email: string) =>
  unwrap(api.post<AuthResponse>('/api/v2/auth/forgot-password', { email }));

export const resetPassword = (token: string, password: string) =>
  unwrap(api.post<AuthResponse>('/api/v2/auth/reset-password', { token, password }));

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
  unwrap(api.get<BillingConfig>('/api/v2/billing/config'));

export const getSubscriptionStatus = async () => {
  const response = await unwrap(api.get<{ success: boolean; data: SubscriptionStatus }>('/api/v2/billing/status'));
  return response.data;
};

export const getBillingUsage = async () => {
  const response = await unwrap(api.get<{ success: boolean; data: BillingUsage }>('/api/v2/billing/usage'));
  return response.data;
};

export const createCheckoutSession = (tier: string = 'basic', interval: string = 'monthly') =>
  unwrap(api.post<CheckoutResponse>('/api/v2/billing/create-checkout', { tier, interval }));

export const createPortalSession = () =>
  unwrap(api.post<CheckoutResponse>('/api/v2/billing/portal'));

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
  const response = await unwrap(api.get<TelemetryNoticeResponse>('/telemetry/notice'));
  return response;
};

export const acceptTelemetry = () =>
  unwrap(api.post<AuthResponse>('/telemetry/accept'));

export const optOutTelemetry = () =>
  unwrap(api.post<AuthResponse>('/telemetry/opt-out'));

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
  unwrap(api.post<{ share_id: number; status: string; message: string }>(`/bills/${billId}/share`, data));

// Get all shares for a bill (owner view)
export const getBillShares = (billId: number) =>
  unwrap(api.get<BillShare[]>(`/bills/${billId}/shares`));

// Revoke a share
export const revokeShare = (shareId: number) =>
  unwrap(api.delete<{ message: string }>(`/shares/${shareId}`));

// Update share split configuration
export const updateShare = (shareId: number, data: { split_type?: string | null; split_value?: number | null }) =>
  unwrap(api.put<{ message: string }>(`/shares/${shareId}`, data));

// Get bills shared with current user
export const getSharedBills = () =>
  unwrap(api.get<SharedBill[]>('/shared-bills'));

// Get pending share invitations
export const getPendingShares = () =>
  unwrap(api.get<PendingShare[]>('/shared-bills/pending'));

// Accept a share invitation
export const acceptShare = (shareId: number) =>
  unwrap(api.post<{ message: string }>(`/shares/${shareId}/accept`));

// Decline a share invitation
export const declineShare = (shareId: number) =>
  unwrap(api.post<{ message: string }>(`/shares/${shareId}/decline`));

// Leave a shared bill
export const leaveShare = (shareId: number) =>
  unwrap(api.post<{ message: string }>(`/shares/${shareId}/leave`));

// Search users for sharing
export const searchUsers = (query: string) =>
  unwrap(api.get<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(query)}`));

export default api;
