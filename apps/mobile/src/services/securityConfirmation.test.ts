import { afterEach, describe, expect, it } from 'vitest';
import { requestSecurityConfirmation, setConfirmationListener } from './securityConfirmation';

afterEach(() => setConfirmationListener(null));
describe('security confirmation request', () => {
  it('fails closed when the account UI is not mounted', async () => {
    await expect(requestSecurityConfirmation('password', 'oauth_link')).resolves.toBeNull();
  });
  it('passes the required method and purpose to the UI', async () => {
    setConfirmationListener((request) => {
      expect(request.method).toBe('email');
      expect(request.purpose).toBe('delete_account');
      request.resolve('123456');
    });
    await expect(requestSecurityConfirmation('email', 'delete_account')).resolves.toBe('123456');
  });
});
