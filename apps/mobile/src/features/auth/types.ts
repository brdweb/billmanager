import type { DatabaseInfo, LoginResponse, User } from '../../types';

export type TwoFactorMethod = 'email_otp' | 'passkey' | 'recovery';

export interface RegistrationResult {
  message: string;
  email_sent?: boolean;
  email_verification_required?: boolean;
  user?: Pick<User, 'id' | 'username' | 'email'>;
}

export interface MessageResult {
  message: string;
}

export interface TeamInviteInfo {
  email: string;
  invited_by: string;
  expires_at: string;
}

export interface TeamInviteAcceptance {
  message: string;
  username: string;
}

export interface ShareInviteInfo {
  bill_name: string;
  bill_amount: number | null;
  /** Present on current servers. Older v2 servers returned only `owner`. */
  owner_username?: string;
  /** Backward-compatible server alias for `owner_username`. */
  owner?: string;
  shared_with_email?: string;
  split_type: string | null;
  split_value: number | null;
  my_portion: number | null;
  expires_at?: string | null;
  updated_at?: string;
}

export interface ShareInviteAcceptance {
  message: string;
  share_id: number;
}

export interface OAuthProvider {
  id: string;
  display_name: string;
  icon: string;
}

export interface OAuthAuthorization {
  auth_url: string;
  state: string;
}

export interface OAuthAccount {
  id: number;
  provider: string;
  provider_email: string | null;
  created_at: string | null;
}

export interface OAuthSession extends LoginResponse {
  expires_in?: number;
  token_type?: string;
  user: User & { is_new_user?: boolean };
  databases: DatabaseInfo[];
}

export interface AuthSessionScope {
  serverProfileId: string;
  databaseId: string | null;
}

export type AuthFlowResult =
  | { status: 'authenticated'; session: LoginResponse; scope: AuthSessionScope }
  | {
      status: 'two_factor_required';
      sessionToken: string;
      methods: TwoFactorMethod[];
      scope: AuthSessionScope;
    }
  | { status: 'password_change_required'; changeToken: string; scope: AuthSessionScope }
  | { status: 'email_verification_required'; message: string }
  | { status: 'error'; message: string };

export interface OAuthCallbackParameters {
  provider: string;
  code: string;
  state: string;
  redirectUri?: string;
}

export type OAuthBrowserResult =
  | { status: 'success'; code: string; state: string; provider?: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface AuthRouteDefinition {
  name:
    | 'Login'
    | 'Register'
    | 'VerifyEmail'
    | 'ResendVerification'
    | 'ForgotPassword'
    | 'ResetPassword'
    | 'ForcedPasswordChange'
    | 'AcceptInvite'
    | 'AcceptShareInvite'
    | 'OAuthProviders'
    | 'OAuthCallback'
    | 'TwoFactorChallenge';
  path: string;
  access: 'public' | 'authenticated';
  capability?: 'registration' | 'sharing' | 'oauth' | 'emailOtp' | 'passkeys';
}
