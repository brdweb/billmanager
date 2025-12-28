import axios from 'axios';

const api = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
  },
  withCredentials: true,
});

// Only log errors in development, never log request data (may contain passwords)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      console.error('API Error:', error.config?.method?.toUpperCase(), error.config?.url, error.response?.status);
    }
    return Promise.reject(error);
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

export const updateUser = (userId: number, data: { email?: string | null }) =>
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

export default api;
