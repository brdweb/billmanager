import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import { SecurityConfirmation } from '../components/SecurityConfirmation';
import { requestSecurityConfirmation } from '../utils/securityConfirmation';

describe('sensitive action confirmation', () => {
  it('starts fresh OIDC sign-in only on an explicit button gesture', async () => {
    const view = render(<MantineProvider><SecurityConfirmation /></MantineProvider>);
    const authenticate = vi.fn(async () => 'purpose-bound-token');
    let result!: Promise<string | null>;
    act(() => { result = requestSecurityConfirmation('oidc', 'oauth_link', authenticate); });
    expect(authenticate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again with your identity provider' }));
    await expect(result).resolves.toBe('purpose-bound-token');
    expect(authenticate).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('collects a password only after explicit submission and clears it afterward', async () => {
    const view = render(<MantineProvider><SecurityConfirmation /></MantineProvider>);
    let result!: Promise<string | null>;
    act(() => { result = requestSecurityConfirmation('password', 'oauth_link'); });
    fireEvent.change(await screen.findByLabelText(/Current password/), { target: { value: 'entered-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(result).resolves.toBe('entered-password');
    view.unmount();
  });

  it('cancels without credentials and rejects a concurrent prompt', async () => {
    const view = render(<MantineProvider><SecurityConfirmation /></MantineProvider>);
    let result!: Promise<string | null>;
    act(() => { result = requestSecurityConfirmation('email', 'delete_account'); });
    await expect(requestSecurityConfirmation('password', 'oauth_link')).resolves.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(result).resolves.toBeNull();
    view.unmount();
  });
});
