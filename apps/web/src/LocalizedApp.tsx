import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ConfigProvider } from './context/ConfigContext';
import { theme } from './theme';

export function LocalizedApp() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'de' ? 'de' : 'en';

  return (
    <DatesProvider
      settings={{
        locale: language,
        firstDayOfWeek: language === 'de' ? 1 : 0,
        weekendDays: [0, 6],
      }}
    >
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" />
        <BrowserRouter>
          <ConfigProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ConfigProvider>
        </BrowserRouter>
      </MantineProvider>
    </DatesProvider>
  );
}
