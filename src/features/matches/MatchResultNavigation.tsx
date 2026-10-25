import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { matchResultStyles as s } from './match-result.styles';

export function MatchResultNavigation() {
  const { t } = useTranslation();
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
      <>
        <path d="M8 3h8v6a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v6m-5 2h10" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
      </>
    )
  };
  return (
    <nav aria-label={t('matches.results.navigation')} {...stylex.props(s.navigation)}>
      {(['home', 'matches', 'community', 'ranking', 'profile'] as const).map((key) => {
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
              {icons[key]}
            </svg>
            {t(`matches.results.nav.${key}`)}
          </>
        );
        return key === 'community' || key === 'ranking' ? (
          <button
            key={key}
            disabled
            title={t('matches.results.navigationUnavailable')}
            {...stylex.props(s.navItem)}
          >
            {content}
          </button>
        ) : (
          <Link
            key={key}
            to={key === 'matches' ? '/matches' : '/dashboard'}
            aria-current={key === 'matches' ? 'page' : undefined}
            {...stylex.props(s.navItem, key === 'matches' && s.navActive)}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
