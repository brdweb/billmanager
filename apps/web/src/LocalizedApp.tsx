import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ConfigProvider } from './context/ConfigContext';
import { normalizeSupportedLanguage, SUPPORTED_LANGUAGES } from './i18n';
import {
  DAYJS_LOCALE_LOADERS,
  loadDateLocale,
  resolveDateLocale,
} from './i18n/dateLocale';
import { theme } from './theme';

export function LocalizedApp() {
  const { i18n } = useTranslation();
  const language = normalizeSupportedLanguage(
    i18n.resolvedLanguage ?? i18n.language,
    SUPPORTED_LANGUAGES
  );
  const resolvedDateLocale = useMemo(
    () => resolveDateLocale(language, SUPPORTED_LANGUAGES, DAYJS_LOCALE_LOADERS),
    [language]
  );
  const [loadedDateLocale, setLoadedDateLocale] = useState(resolvedDateLocale);

  useEffect(() => {
    let isCurrentLanguage = true;

    void loadDateLocale(resolvedDateLocale, DAYJS_LOCALE_LOADERS).then((dateLocale) => {
      if (isCurrentLanguage) {
        setLoadedDateLocale(dateLocale);
      }
    });

    return () => {
      isCurrentLanguage = false;
    };
  }, [resolvedDateLocale]);

  const dateLocale =
    loadedDateLocale.locale === resolvedDateLocale.locale
      ? loadedDateLocale
      : resolvedDateLocale;

  return (
    <DatesProvider
      settings={{
        locale: dateLocale.locale,
        firstDayOfWeek: dateLocale.firstDayOfWeek,
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
