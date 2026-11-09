import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { homeStyles as s } from './home.styles';

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
  ranking: (
    <path d="M8 3h8v6a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v6m-5 2h10" />
  ),
  profile: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
    </>
  )
};

/** Every destination exists: the Matches route or an in-page anchor of an authorized section. */
const destinations = [
  { key: 'home', href: '#home-top' },
  { key: 'matches', to: '/matches' },
  { key: 'community', href: '#home-community' },
  { key: 'ranking', href: '#home-ranking' },
  { key: 'profile', href: '#home-profile' }
] as const;

export function HomeNavigation() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('matches.results.navigation')} {...stylex.props(s.navigation)}>
      {destinations.map((destination) => {
        const content = (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              {...stylex.props(s.navIcon)}
            >
              {icons[destination.key]}
            </svg>
            {t(`matches.results.nav.${destination.key}`)}
          </>
        );
        return 'to' in destination ? (
          <Link key={destination.key} to={destination.to} {...stylex.props(s.navItem)}>
            {content}
          </Link>
        ) : (
          <a
            key={destination.key}
            href={destination.href}
            aria-current={destination.key === 'home' ? 'page' : undefined}
            {...stylex.props(s.navItem, destination.key === 'home' && s.navActive)}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}
