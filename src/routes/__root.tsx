import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState
} from '@tanstack/react-router';
import { I18nextProvider } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { createI18n, resolveLocale } from '../i18n/config';
import { getInitialLocale, saveLocale } from '../i18n/locale.functions';
import { PwaRegistration } from '../components/PwaRegistration';
import { DevStyleXInject } from '../components/DevStyleXInject';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import { getInitialTheme, saveTheme } from '../features/theme/theme.functions';
import '../styles.css';
import { rootStyles } from '../root.styles';

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
  const isAuthJourney = useRouterState({
    select: (state) =>
      [
        '/login',
        '/onboarding',
        '/onboarding/account',
        '/onboarding/community',
        '/forgot-password',
        '/reset-password'
      ].includes(state.location.pathname)
  });
  const [locale, setLocale] = useState(() => resolveLocale(initialLocale));
  const [theme, setTheme] = useState(initialTheme);
  const [i18n] = useState(() => createI18n(locale));
  const localeRef = useRef(locale);
  const persistedLocaleRef = useRef<string | undefined>(locale);
  const localeRequest = useRef(0);
  const localeQueue = useRef(Promise.resolve());
  useEffect(() => {
    document.documentElement.dataset.appHydrated = 'true';
  }, []);
  return (
    <html lang={locale} data-theme={theme}>
      <head>
        <HeadContent />
        <DevStyleXInject />
      </head>
      <body {...stylex.props(stylex.defaultMarker())}>
        <I18nextProvider i18n={i18n}>
          {!isAuthJourney && (
            <div {...stylex.props(rootStyles.controls)}>
              <label {...stylex.props(rootStyles.chip, rootStyles.focusChip)}>
                <span
                  aria-hidden="true"
                  {...stylex.props(rootStyles.chipText, rootStyles.localeText)}
                >
                  {locale.slice(0, 2)}
                </span>
                <select
                  id="locale"
                  aria-label={i18n.t('language')}
                  {...stylex.props(rootStyles.locale)}
                  value={locale}
                  onChange={(event) => {
                    const next = resolveLocale(event.target.value);
                    const request = ++localeRequest.current;
                    localeQueue.current = localeQueue.current
                      .catch(() => undefined)
                      .then(async () => {
                        const previous = localeRef.current;
                        let saveSucceeded = false;
                        try {
                          await saveLocale({ data: next });
                          saveSucceeded = true;
                          persistedLocaleRef.current = next;
                          if (request !== localeRequest.current) return;
                          await i18n.changeLanguage(next);
                          if (request !== localeRequest.current) {
                            await i18n.changeLanguage(previous);
                            return;
                          }
                          localeRef.current = next;
                          setLocale(next);
                          document.documentElement.lang = next;
                        } catch {
                          if (!saveSucceeded) persistedLocaleRef.current = undefined;
                          if (localeRef.current === previous) {
                            try {
                              await i18n.changeLanguage(previous);
                              if (persistedLocaleRef.current !== previous) {
                                await saveLocale({ data: previous });
                                persistedLocaleRef.current = previous;
                              }
                            } catch {
                              // Keep the rendered locale unchanged if preference recovery also fails.
                            }
                          }
                        }
                      });
                  }}
                >
                  <option value="en">{i18n.t('languageNames.en')}</option>
                  <option value="pt-BR">{i18n.t('languageNames.pt-BR')}</option>
                  <option value="es">{i18n.t('languageNames.es')}</option>
                </select>
              </label>
              <label {...stylex.props(rootStyles.chip, rootStyles.focusChip)}>
                <span aria-hidden="true" {...stylex.props(rootStyles.chipText)}>
                  {i18n.t(theme)}
                </span>
                <select
                  id="theme"
                  aria-label={i18n.t('theme')}
                  {...stylex.props(rootStyles.locale)}
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
              </label>
            </div>
          )}
          <Outlet />
          <PwaRegistration />
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  );
}
