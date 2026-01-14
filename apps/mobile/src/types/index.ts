// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Auth types
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
  databases: DatabaseInfo[];
}

export interface User {
  id: number;
  username: string;
  email?: string;
  role: 'admin' | 'user';
  is_account_owner?: boolean;
}

export interface DatabaseInfo {
  id: number;
  name: string;
  display_name: string;
}

// Bill types
export interface Bill {
  id: number;
  name: string;
  amount: number | null;
  varies: boolean;
  frequency: string;
  frequency_type: string;
  frequency_config: string;
  next_due: string;
  auto_payment: boolean;
  icon: string;
  type: 'expense' | 'deposit';
  account: string | null;
  notes: string | null;
  archived: boolean;
  last_updated?: string;
  avg_amount?: number;
  is_shared: boolean;
  share_info?: {
    share_id: number;
    owner_name: string;
    my_portion: number | null;
    my_portion_paid: boolean;
    my_portion_paid_date: string | null;
  };
}

export interface Payment {
  id: number;
  bill_id: number;
  amount: number;
  payment_date: string;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  // Enriched fields from API (when fetching all payments)
  bill_name?: string;
  bill_icon?: string;
  bill_type?: 'expense' | 'deposit';
  original_bill_type?: 'expense' | 'deposit' | 'bill';
  is_share_payment?: boolean;
  is_received_payment?: boolean;  // True = money received from sharee (income)
}

// Sync types
export interface SyncResponse {
  bills: Bill[];
  payments: Payment[];
  server_time: string;
  has_more?: boolean;
}

export interface SyncPushRequest {
  bills?: Partial<Bill>[];
  payments?: Partial<Payment>[];
  deleted_bills?: number[];
  deleted_payments?: number[];
}

export interface SyncPushResponse {
  accepted_bills: { id: number; action: string; client_ref?: string }[];
  rejected_bills: { id: number; reason: string; server_data?: Bill }[];
  accepted_payments: { id: number; action: string; client_ref?: string }[];
  rejected_payments: { id: number; reason: string; server_data?: Payment }[];
  server_time: string;
}

// Device types
export interface DeviceInfo {
  device_id: string;
  device_name?: string;
  platform: 'ios' | 'android' | 'web' | 'desktop';
  push_token?: string;
  push_provider?: string;
  app_version?: string;
  os_version?: string;
  notification_settings?: Record<string, boolean>;
}

// Stats types
export interface MonthlyStats {
  month: string;
  total_expenses: number;
  total_deposits: number;
  net: number;
}

// Processed monthly stats for UI display
export interface ProcessedMonthlyStats {
  month: string;
  paid: number;
  paidCount: number;
  income: number;
  incomeCount: number;
  remaining: number;
  remainingCount: number;
  net: number;
}

// Admin types
export interface AdminUser {
  id: number;
  username: string;
  email?: string;
  role: 'admin' | 'user';
  created_at?: string;
}

export interface Invitation {
  id: number;
  email: string;
  role: 'admin' | 'user';
  database_ids: number[];
  created_at: string;
  expires_at: string;
  created_by?: string;
}

export interface DatabaseAccess {
  user_id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface DatabaseWithAccess extends DatabaseInfo {
  users?: DatabaseAccess[];
}

// Subscription types
export interface SubscriptionStatus {
  has_subscription: boolean;
  status?: 'active' | 'canceled' | 'past_due' | 'trialing';
  tier?: 'free' | 'basic' | 'plus';
  effective_tier: 'free' | 'basic' | 'plus';
  billing_interval?: 'monthly' | 'annual';
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  is_trialing?: boolean;
  is_trial_expired?: boolean;
  trial_days_remaining?: number;
}

export interface UsageItem {
  used: number;
  limit: number;
  unlimited: boolean;
}

export interface BillingUsage {
  tier: 'free' | 'basic' | 'plus';
  usage: {
    bills: UsageItem;
    bill_groups: UsageItem;
    family_members: UsageItem;
  };
}

// Bill Sharing types
export interface BillShare {
  id: number;
  shared_with: string;
  identifier_type: 'username' | 'email';
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  created_at: string;
  accepted_at: string | null;
}

export interface SharedBill {
  share_id: number;
  bill: {
    id: number;
    name: string;
    amount: number | null;
    varies: boolean;
    frequency: string;
    next_due: string;
    icon: string;
    type: 'expense' | 'deposit';
  };
  owner: string;
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  my_portion: number | null;
  last_payment: {
    amount: number;
    date: string;
  } | null;
  status: 'accepted';
}

export interface PendingShare {
  share_id: number;
  bill_name: string;
  bill_amount: number | null;
  bill_icon: string;
  owner: string;
  split_type: 'percentage' | 'fixed' | 'equal' | null;
  split_value: number | null;
  created_at: string;
}

export interface UserSearchResult {
  id: number;
  username: string;
}
