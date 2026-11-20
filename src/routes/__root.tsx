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
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/figtree/800.css';
import { getInitialTheme, saveTheme } from '../features/theme/theme.functions';
import '../styles.css';
import { RefreshStatusProvider } from '../components/RefreshStatusProvider';
import { SkipLink } from '../components/SkipLink';
import { accessibilityStyles } from '../components/accessibility.styles';
import { rootStyles } from '../root.styles';
import { appShellStyles } from '../features/app-shell/app-shell.styles';

export const Route = createRootRoute({
  beforeLoad: async () => ({ locale: await getInitialLocale(), theme: await getInitialTheme() }),
  component: Root,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Padel Friend' }
    ],
    links: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/favicon.png', sizes: '64x64', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }
    ]
  })
});

function PublicControlIcon({ icon }: { icon: 'globe' | 'moon' | 'sun' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(rootStyles.homeIcon)}
    >
      {icon === 'globe' ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" />
        </>
      ) : icon === 'moon' ? (
        <path d="M20.9 13.35a9 9 0 1 1-10.25-10.25 7 7 0 0 0 10.25 10.25Z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42m-11.3 11.3-1.42 1.42" />
        </>
      )}
    </svg>
  );
}

function Root() {
  const { locale: initialLocale, theme: initialTheme } = Route.useRouteContext();
  const isPublicHomepage = useRouterState({ select: (state) => state.location.pathname === '/' });
  const isAuthJourney = useRouterState({
    select: (state) =>
      [
        '/login',
        '/onboarding',
        '/onboarding/account',
        '/onboarding/community',
        '/forgot-password',
        '/reset-password',
        '/auth/confirm-invite'
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
    <html lang={locale} data-theme={theme} {...stylex.props(appShellStyles.documentInset)}>
      <head>
        <HeadContent />
        <DevStyleXInject />
      </head>
      <body {...stylex.props(stylex.defaultMarker())}>
        <I18nextProvider i18n={i18n}>
          <SkipLink />
          <RefreshStatusProvider>
            {!isAuthJourney && (
              <div
                {...stylex.props(rootStyles.controls, isPublicHomepage && rootStyles.homeControls)}
              >
                <label
                  {...stylex.props(
                    rootStyles.chip,
                    rootStyles.focusChip,
                    isPublicHomepage && rootStyles.homeChip
                  )}
                >
                  <span
                    aria-hidden="true"
                    {...stylex.props(rootStyles.chipText, rootStyles.localeText)}
                  >
                    {isPublicHomepage ? <PublicControlIcon icon="globe" /> : locale.slice(0, 2)}
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
                <label
                  {...stylex.props(
                    rootStyles.chip,
                    rootStyles.focusChip,
                    isPublicHomepage && rootStyles.homeChip
                  )}
                >
                  <span aria-hidden="true" {...stylex.props(rootStyles.chipText)}>
                    {isPublicHomepage ? (
                      <PublicControlIcon icon={theme === 'dark' ? 'sun' : 'moon'} />
                    ) : (
                      i18n.t(theme)
                    )}
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
            <div id="main-content" tabIndex={-1} {...stylex.props(accessibilityStyles.content)}>
              <Outlet />
            </div>
            <PwaRegistration />
          </RefreshStatusProvider>
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  );
}
