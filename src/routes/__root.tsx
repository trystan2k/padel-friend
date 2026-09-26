import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { I18nextProvider } from 'react-i18next';
import { useState } from 'react';
import { createI18n, resolveLocale } from '../i18n/config';
import { getInitialLocale, saveLocale } from '../i18n/locale.functions';
import { PwaRegistration } from '../components/PwaRegistration';
import { getInitialTheme, saveTheme } from '../features/theme/theme.functions';
import '../styles.css';

export const Route = createRootRoute({
  beforeLoad: async () => ({ locale: await getInitialLocale(), theme: await getInitialTheme() }),
  component: Root,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Padel Friend' }
    ],
    links: [{ rel: 'manifest', href: '/manifest.webmanifest' }]
  })
});

function Root() {
  const { locale: initialLocale, theme: initialTheme } = Route.useRouteContext();
  const [locale, setLocale] = useState(() => resolveLocale(initialLocale));
  const [theme, setTheme] = useState(initialTheme);
  const [i18n] = useState(() => createI18n(locale));
  return (
    <html lang={locale} data-theme={theme}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>
          <label htmlFor="locale">{i18n.t('language')}</label>
          <select
            id="locale"
            value={locale}
            onChange={(event) => {
              const next = resolveLocale(event.target.value);
              setLocale(next);
              void i18n.changeLanguage(next);
              document.documentElement.lang = next;
              void saveLocale({ data: next });
            }}
          >
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="es">Español</option>
          </select>
          <label htmlFor="theme">{i18n.t('theme')}</label>
          <select
            id="theme"
            value={theme}
            onChange={(event) => {
              const next = event.target.value === 'dark' ? 'dark' : 'light';
              setTheme(next);
              document.documentElement.dataset.theme = next;
              void saveTheme({ data: next });
            }}
          >
            <option value="light">{i18n.t('light')}</option>
            <option value="dark">{i18n.t('dark')}</option>
          </select>
          <Outlet />
          <PwaRegistration />
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  );
}
