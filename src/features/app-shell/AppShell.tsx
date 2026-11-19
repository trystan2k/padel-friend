import * as stylex from '@stylexjs/stylex';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { parseHomeSearch } from '../home/home.validators';
import { resolveAppShell } from './app-shell';
import { appShellStyles as s } from './app-shell.styles';

const icons = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v11H3Z" />
      <path d="M9 21v-8h6v8" />
    </>
  ),
  matches: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18M8 15h1m6 0h1m-8 3h1" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 8m2 3a6 6 0 0 1 4 6" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  create: <path d="M12 5v14M5 12h14" />
};

function Icon({ name, large = false }: { name: keyof typeof icons; large?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(s.icon, large && s.createIcon)}
    >
      {icons[name]}
    </svg>
  );
}

/**
 * The one bottom navigation of the protected app: Home, Matches, central Create, Community, Me.
 * Ranking is not a destination; it is reached inside Community. Visibility and the current tab
 * come from the path alone (resolveAppShell).
 */
export function AppShell() {
  const { t } = useTranslation();
  const location = useRouterState({ select: (state) => state.location });
  const { visible, active } = resolveAppShell(location.pathname);
  const community = parseHomeSearch(location.search).community;
  const scopedId =
    active === 'community'
      ? parseHomeSearch({ community: location.pathname.split('/')[2] }).community
      : undefined;
  if (!visible) return null;
  const tab = (destination: 'home' | 'matches' | 'community' | 'me') => ({
    'aria-current': active === destination ? ('page' as const) : undefined,
    ...stylex.props(s.tab, active === destination && s.tabActive)
  });
  return (
    <>
      <div aria-hidden="true" {...stylex.props(s.clearance)} />
      <nav data-app-nav aria-label={t('appShell.navigation')} {...stylex.props(s.bar)}>
        <ul {...stylex.props(s.list)}>
          <li {...stylex.props(s.item)}>
            <Link to="/dashboard" activeOptions={{ exact: true }} {...tab('home')}>
              <Icon name="home" />
              {t('appShell.nav.home')}
            </Link>
          </li>
          <li {...stylex.props(s.item)}>
            <Link to="/matches" {...tab('matches')}>
              <Icon name="matches" />
              {t('appShell.nav.matches')}
            </Link>
          </li>
          <li {...stylex.props(s.item)}>
            <Link
              to="/matches/create"
              aria-label={t('appShell.nav.create')}
              {...stylex.props(s.create)}
            >
              <Icon name="create" large />
            </Link>
          </li>
          <li {...stylex.props(s.item)}>
            {scopedId ? (
              <Link
                to="/community/$communityId"
                params={{ communityId: scopedId }}
                activeOptions={{ exact: true }}
                {...tab('community')}
              >
                <Icon name="community" />
                {t('appShell.nav.community')}
              </Link>
            ) : (
              <Link
                to="/community"
                search={{ community }}
                activeOptions={{ exact: true }}
                {...tab('community')}
              >
                <Icon name="community" />
                {t('appShell.nav.community')}
              </Link>
            )}
          </li>
          <li {...stylex.props(s.item)}>
            <Link to="/me" {...tab('me')}>
              <Icon name="me" />
              {t('appShell.nav.me')}
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
