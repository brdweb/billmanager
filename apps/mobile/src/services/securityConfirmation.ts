export interface ConfirmationRequest {
  method: 'password' | 'email' | 'oidc';
  purpose: string;
  authenticate?: () => Promise<string>;
  resolve: (value: string | null) => void;
}
let listener: ((request: ConfirmationRequest) => void) | null = null;
export function setConfirmationListener(next: typeof listener) { listener = next; }
export function requestSecurityConfirmation(method: ConfirmationRequest['method'], purpose: string, authenticate?: () => Promise<string>): Promise<string | null> {
  return listener ? new Promise((resolve) => listener?.({ method, purpose, authenticate, resolve })) : Promise.resolve(null);
}
