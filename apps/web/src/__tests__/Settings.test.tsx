import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('Settings page tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only exposes the Settings tab to regular users', () => {
    vi.mocked(useAuth).mockReturnValue({ isAdmin: false } as unknown as ReturnType<typeof useAuth>);

    renderSettings('/settings?tab=users');

    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Bill Groups' })).not.toBeInTheDocument();
  });

  it('exposes Users and Bill Groups tabs to administrators', () => {
    vi.mocked(useAuth).mockReturnValue({ isAdmin: true } as unknown as ReturnType<typeof useAuth>);

    renderSettings('/settings?tab=users');

    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bill Groups' })).toBeInTheDocument();
    expect(screen.getByText('Users content')).toBeVisible();
  });
});
