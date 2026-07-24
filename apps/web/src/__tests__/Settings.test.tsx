import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Settings } from '../pages/Settings';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/TwoFactorSettings', () => ({
  TwoFactorSettings: () => <div>Two-factor settings</div>,
}));

vi.mock('../components/LinkedAccounts', () => ({
  LinkedAccounts: () => <div>Linked accounts</div>,
}));

vi.mock('../components/AccountDangerZone', () => ({
  AccountDangerZone: () => <div>Account danger zone</div>,
}));

vi.mock('../components/AdminPanel/UsersTab', () => ({
  UsersTab: () => <div>Users content</div>,
}));

vi.mock('../components/AdminPanel/DatabasesTab', () => ({
  DatabasesTab: () => <div>Bill groups content</div>,
}));

function renderSettings(path = '/settings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MantineProvider>
        <Settings />
      </MantineProvider>
    </MemoryRouter>
  );
}

function mockAuth(isAdmin: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    isLoggedIn: true,
    isAdmin,
    role: isAdmin ? 'admin' : 'user',
    user: null,
    databases: [],
    currentDb: null,
    isLoading: false,
    pendingPasswordChange: null,
    pending2FA: null,
    login: vi.fn(async () => ({ success: true })),
    loginWithOAuth: vi.fn(async () => ({ success: true })),
    complete2FA: vi.fn(async () => ({ success: true })),
    cancel2FA: vi.fn(),
    logout: vi.fn(async () => undefined),
    selectDatabase: vi.fn(async () => undefined),
    completePasswordChange: vi.fn(async () => ({ success: true })),
    refreshAuth: vi.fn(async () => undefined),
  });
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps account settings separate from the admin modal', () => {
    mockAuth(false);

    renderSettings('/settings?tab=users');

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByText('Two-factor settings')).toBeVisible();
    expect(screen.getByText('Linked accounts')).toBeVisible();
    expect(screen.getByText('Account danger zone')).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Users content')).not.toBeInTheDocument();
    expect(screen.queryByText('Bill groups content')).not.toBeInTheDocument();
  });

  it('shows language options from discovered catalog metadata', () => {
    mockAuth(false);
    renderSettings();

    const languageSelect = screen.getByRole('textbox', { name: 'Language' });
    expect(languageSelect).toHaveValue('English');
    fireEvent.click(languageSelect);
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
  });
});
