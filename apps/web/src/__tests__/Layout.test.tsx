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

function renderLayout(onAdminClick = vi.fn()) {
  render(
    <MantineProvider>
      <Layout sidebar={<div>Sidebar</div>} onAdminClick={onAdminClick}>
        <div>Content</div>
      </Layout>
    </MantineProvider>
  );

  return onAdminClick;
}

describe('Layout admin navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose admin navigation to regular users', () => {
    mockAuth(false);
    const onAdminClick = renderLayout();

    expect(onAdminClick).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('keeps the Admin label for administrators', () => {
    mockAuth(true);
    const onAdminClick = renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));

    expect(onAdminClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
