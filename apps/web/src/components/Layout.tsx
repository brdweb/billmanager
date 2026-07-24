import {
  AppShell,
  Group,
  Title,
  Button,
  Select,
  ActionIcon,
  useMantineColorScheme,
  Burger,
  Box,
  Affix,
  Transition,
  Drawer,
} from '@mantine/core';
import { useDisclosure, useWindowScroll, useMediaQuery } from '@mantine/hooks';
import { IconSun, IconMoon, IconSettings, IconLogout, IconCreditCard, IconArrowUp } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  onAdminClick: () => void;
  onBillingClick?: () => void;
}

export function Layout({ children, sidebar, onAdminClick, onBillingClick }: LayoutProps) {
  const { t } = useTranslation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure();
  const { isLoggedIn, isAdmin, databases, currentDb, selectDatabase, logout } = useAuth();
  const [scroll, scrollTo] = useWindowScroll();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const handleDatabaseChange = (value: string | null) => {
    if (value) {
      selectDatabase(value);
    }
  };

  return (
    <>
      <AppShell header={{ height: 60 }} padding="md">
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group>
              {isMobile && (
                <Burger opened={drawerOpened} onClick={toggleDrawer} size="sm" />
              )}
              <img src="/logo_icon.svg" alt="BillManager" style={{ width: 36, height: 36 }} />
              <Title order={3} c="billGreen">BillManager</Title>
            </Group>

            <Group>
              {isLoggedIn && databases.length > 0 && (
                <Select
                  placeholder={t('layout.selectBillGroupPlaceholder')}
                  data={[
                    { value: '_all_', label: t('layout.allBuckets') },
                    ...databases.map((db) => ({
                      value: db.name,
                      label: db.display_name,
                    })),
                  ]}
                  value={currentDb}
                  onChange={handleDatabaseChange}
                  size="sm"
                  w={180}
                />
              )}

              <ActionIcon
                variant="default"
                size="lg"
                onClick={() => toggleColorScheme()}
                aria-label={t('layout.toggleColorScheme')}
              >
                {colorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
              </ActionIcon>

              {isLoggedIn && (
                <Group gap="xs">
                  {isAdmin && onBillingClick && (
                    <Button
                      variant="light"
                      color="billGreen"
                      size="sm"
                      leftSection={<IconCreditCard size={16} />}
                      onClick={onBillingClick}
                    >
                      {t('layout.billing')}
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="light"
                      color="orange"
                      size="sm"
                      leftSection={<IconSettings size={16} />}
                      onClick={onAdminClick}
                    >
                      {t('layout.admin')}
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    color="gray"
                    size="sm"
                    leftSection={<IconLogout size={16} />}
                    onClick={logout}
                  >
                    {t('layout.logout')}
                  </Button>
                </Group>
              )}
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Group align="flex-start" wrap="nowrap" gap="md">
            {/* Sidebar - hidden on mobile, shown via drawer */}
            {!isMobile && (
              <Box w={285} style={{ flexShrink: 0 }}>
                {sidebar}
              </Box>
            )}

            {/* Main content */}
            <Box style={{ flex: 1, minWidth: 0 }}>
              {children}
            </Box>
          </Group>
        </AppShell.Main>
      </AppShell>

      {/* Mobile drawer for sidebar */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size="280"
        padding="md"
        title={t('sidebar.navDashboard')}
      >
        {sidebar}
      </Drawer>

      {/* Back to top button */}
      <Affix position={{ bottom: 20, right: 20 }}>
        <Transition transition="slide-up" mounted={scroll.y > 200}>
          {(transitionStyles) => (
            <ActionIcon
              style={transitionStyles}
              size="lg"
              radius="xl"
              variant="filled"
              color="billGreen"
              onClick={() => scrollTo({ y: 0 })}
              aria-label={t('layout.scrollToTop')}
            >
              <IconArrowUp size={18} />
            </ActionIcon>
          )}
        </Transition>
      </Affix>
    </>
  );
}
