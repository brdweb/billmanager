import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({
  authenticated: false,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useEffect: vi.fn(),
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => [initial, vi.fn()],
  };
  return {
    ...actual,
    ...hooks,
    default: { ...actual, ...hooks },
  };
});

vi.mock('@react-navigation/native', () => ({
  DarkTheme: { colors: {} },
  DefaultTheme: { colors: {} },
  NavigationContainer: 'NavigationContainer',
}));

vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'StackNavigator',
    Screen: 'StackScreen',
  }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../api/client', () => ({
  api: { getTelemetryNotice: vi.fn() },
}));
vi.mock('../components/TelemetryNoticeModal', () => ({ default: 'TelemetryNoticeModal' }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: navigationMocks.authenticated,
  }),
}));
vi.mock('../context/ServerProfileContext', () => ({
  useServerProfiles: () => ({ compatibility: null }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      primary: '#000',
      background: '#fff',
      surface: '#fff',
      text: '#000',
      border: '#ccc',
      warning: '#f00',
    },
  }),
}));
vi.mock('../screens/UpgradeRequiredScreen', () => ({ default: 'UpgradeRequiredScreen' }));
vi.mock('./AuthFlowNavigator', () => ({ default: 'AuthFlowNavigator' }));
vi.mock('./MainTabs', () => ({ default: 'MainTabs' }));
vi.mock('./linking', () => ({ linking: {} }));

import AppNavigator from './AppNavigator';

function collectStackScreens(node: ReactNode): string[] {
  const names: string[] = [];
  const visit = (candidate: ReactNode) => {
    if (!isValidElement(candidate)) return;
    const element = candidate as ReactElement<Record<string, unknown>>;
    if (element.type === 'StackScreen') {
      names.push(element.props.name as string);
    }
    Children.forEach(element.props.children as ReactNode, visit);
  };
  visit(node);
  return names;
}

describe('AppNavigator authentication route sets', () => {
  afterEach(() => {
    navigationMocks.authenticated = false;
    delete process.env.EXPO_PUBLIC_DESIGN_PREVIEW;
  });

  it('only exposes the authentication flow to signed-out users', () => {
    expect(collectStackScreens(AppNavigator())).toEqual(['Auth']);
  });

  it('removes the authentication flow after sign-in', () => {
    navigationMocks.authenticated = true;

    expect(collectStackScreens(AppNavigator())).toEqual(['Main']);
  });

  it('keeps design preview in the authenticated application', () => {
    process.env.EXPO_PUBLIC_DESIGN_PREVIEW = '1';

    expect(collectStackScreens(AppNavigator())).toEqual(['Main']);
  });
});
