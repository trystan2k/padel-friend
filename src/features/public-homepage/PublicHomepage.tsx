import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIVACY_CONTACT_EMAIL } from '../privacy/privacy-content';
import { styles } from './public-homepage.styles';

const featureIcons = {
  findMatches: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  inviteFriends: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M19 8v6M16 11h6" />
    </>
  ),
  trackResults: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16M10 14.7V17c0 .6-.5 1-1.2 1.2C7.8 18.7 7 20.2 7 22M14 14.7V17c0 .6.5 1 1.2 1.2 1 .5 1.8 2 1.8 3.8" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>
  )
} satisfies Record<string, ReactNode>;

const featureKeys = ['findMatches', 'inviteFriends', 'trackResults'] as const;

export function PublicHomepage({ authenticated }: { authenticated: boolean }) {
  const { t } = useTranslation();

  return (
    <div {...stylex.props(styles.page)}>
      <header>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
      </header>

      <main {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.hero)}>
          <h1 {...stylex.props(styles.title)}>{t('publicHomepage.hero.title')}</h1>
          <p {...stylex.props(styles.description)}>{t('publicHomepage.hero.description')}</p>
          <div {...stylex.props(styles.actions)}>
            {authenticated ? (
              <Link to="/dashboard" {...stylex.props(styles.cta, styles.ctaPrimary)}>
                {t('publicHomepage.actions.dashboard')}
              </Link>
            ) : (
              <>
                <Link to="/login" {...stylex.props(styles.cta, styles.ctaPrimary)}>
                  {t('publicHomepage.actions.signIn')}
                </Link>
                <Link to="/onboarding/account" {...stylex.props(styles.cta, styles.ctaSecondary)}>
                  {t('publicHomepage.actions.createAccount')}
                </Link>
              </>
            )}
          </div>
        </div>

        <ul {...stylex.props(styles.features)}>
          {featureKeys.map((key) => (
            <li key={key} {...stylex.props(styles.card)}>
              <span aria-hidden="true" {...stylex.props(styles.iconTile)}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...stylex.props(styles.icon)}
                >
                  {featureIcons[key]}
                </svg>
              </span>
              <h2 {...stylex.props(styles.cardTitle)}>
                {t(`publicHomepage.features.${key}.title`)}
              </h2>
              <p {...stylex.props(styles.cardDescription)}>
                {t(`publicHomepage.features.${key}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </main>

      <footer {...stylex.props(styles.footer)}>
        {/* Plain anchor: the href must stay the canonical /privacy used as the Google Branding link. */}
        <a href="/privacy" {...stylex.props(styles.footerLink)}>
          {t('auth.privacyLink')}
        </a>
        <div {...stylex.props(styles.contact)}>
          <p {...stylex.props(styles.footerText)}>{t('publicHomepage.footer.contact')}</p>
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} {...stylex.props(styles.footerLink)}>
            {t('publicHomepage.footer.contactEmail', { email: PRIVACY_CONTACT_EMAIL })}
          </a>
        </div>
        <p {...stylex.props(styles.footerText, styles.footerNote)}>
          {t('publicHomepage.footer.operator')}
        </p>
        <p {...stylex.props(styles.footerText)}>{t('publicHomepage.footer.audience')}</p>
      </footer>
    </div>
  );
}
