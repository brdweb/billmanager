import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { Settings } from '../pages/Settings';

const updateCurrency = vi.fn(async () => ({ success: true }));

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../context/ConfigContext', () => ({
  useConfig: vi.fn(),
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
    user: {
      id: 1,
      username: 'tester',
      role: isAdmin ? 'admin' : 'user',
      currency: 'USD',
    },
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
    updateCurrency,
  });
}

describe('Settings page tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConfig).mockReturnValue({
      config: { supported_currencies: ['USD', 'EUR'] },
    } as ReturnType<typeof useConfig>);
  });

  it('only exposes the Settings tab to regular users', () => {
    mockAuth(false);

    renderSettings('/settings?tab=users');

    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Bill Groups' })).not.toBeInTheDocument();
  });

  it('exposes Users and Bill Groups tabs to administrators', () => {
    mockAuth(true);

    renderSettings('/settings?tab=users');

    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bill Groups' })).toBeInTheDocument();
    expect(screen.getByText('Users content')).toBeVisible();
  });

  it('shows language options from discovered catalog metadata', () => {
    mockAuth(false);
    renderSettings();

    const languageSelect = screen.getByLabelText('Language', { selector: 'input' });
    expect(languageSelect).toHaveValue('English');
    fireEvent.click(languageSelect);
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
  });

  it('saves currency as a user preference', () => {
    mockAuth(false);
    renderSettings();

    const currencySelect = screen.getByLabelText('Currency', { selector: 'input' });
    expect(currencySelect).toHaveValue('USD — US Dollar');
    fireEvent.click(currencySelect);
    fireEvent.click(screen.getByRole('option', { name: 'EUR — Euro' }));

    expect(updateCurrency).toHaveBeenCalledWith('EUR');
  });
});
