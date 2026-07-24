import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';
import { LocalizedApp } from './LocalizedApp';
import i18n from './i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new TypeError('Application root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <LocalizedApp />
    </I18nextProvider>
  </StrictMode>
);
