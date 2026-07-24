import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { Layout } from '../components/Layout';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const selectDatabase = vi.fn();
const logout = vi.fn();

function mockAuth(isAdmin: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    isLoggedIn: true,
    isAdmin,
    databases: [],
    currentDb: null,
    selectDatabase,
    logout,
  } as unknown as ReturnType<typeof useAuth>);
}

function renderLayout(onSettingsClick = vi.fn()) {
  render(
    <MantineProvider>
      <Layout sidebar={<div>Sidebar</div>} onSettingsClick={onSettingsClick}>
        <div>Content</div>
      </Layout>
    </MantineProvider>
  );

  return onSettingsClick;
}

describe('Layout settings navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a Settings button to regular users', () => {
    mockAuth(false);
    const onSettingsClick = renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onSettingsClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('keeps the Admin label for administrators', () => {
    mockAuth(true);
    const onSettingsClick = renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));

    expect(onSettingsClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
