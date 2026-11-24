import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import brandIcon from '../../../docs/design/padel-friends-app-icon.png';
import { styles as buttonStyles } from '../../components/ui/button.styles';
import { controlStyles } from '../../components/ui/control.styles';
import { PrivacyLink } from '../../components/ui/PrivacyLink';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { textLinkProps } from '../../components/ui/TextLink';
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
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M19 8v6M16 11h6" />
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

const features = ['findMatches', 'inviteFriends', 'trackResults'] as const;

// CTAs navigate. Reuse the button appearance without overriding native link semantics.
function ctaProps(variant: 'primary' | 'secondary') {
  return stylex.props(
    buttonStyles.base,
    buttonStyles[variant],
    controlStyles.size,
    controlStyles.focusRing,
    styles.cta
  );
}

export function PublicHomepage({ authenticated }: { authenticated: boolean }) {
  const { t } = useTranslation();

  return (
    <div data-public-homepage="" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.brand)}>
          <img src={brandIcon} alt="" {...stylex.props(styles.logo)} />
          <span>{t('publicHomepage.brand')}</span>
        </div>
      </header>

      <main {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.hero)}>
          <h1 {...stylex.props(styles.title)}>{t('publicHomepage.hero.title')}</h1>
          <p {...stylex.props(styles.description)}>{t('publicHomepage.hero.description')}</p>
          <div {...stylex.props(styles.actions)}>
            {authenticated ? (
              <>
                <Link to="/dashboard" {...ctaProps('primary')}>
                  {t('publicHomepage.actions.dashboard')}
                </Link>
                <p {...stylex.props(styles.signedInNote)}>
                  {t('publicHomepage.actions.signedInNote')}
                </p>
              </>
            ) : (
              <>
                <Link to="/login" {...ctaProps('primary')}>
                  {t('publicHomepage.actions.signIn')}
                </Link>
                <Link to="/onboarding/account" {...ctaProps('secondary')}>
                  {t('publicHomepage.actions.createAccount')}
                </Link>
              </>
            )}
          </div>
        </div>

        <section {...stylex.props(styles.features)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{t('publicHomepage.features.heading')}</h2>
          <ul {...stylex.props(styles.featureList)}>
            {features.map((key) => (
              <li key={key}>
                <SurfaceCard xstyle={styles.card}>
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
                  <div {...stylex.props(styles.cardCopy)}>
                    <h3 {...stylex.props(styles.cardTitle)}>
                      {t(`publicHomepage.features.${key}.title`)}
                    </h3>
                    <p {...stylex.props(styles.body)}>
                      {t(`publicHomepage.features.${key}.description`)}
                    </p>
                  </div>
                </SurfaceCard>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.footerLinks)}>
          <PrivacyLink canonical />
          <div {...stylex.props(styles.contact)}>
            <p {...stylex.props(styles.contactLabel)}>{t('publicHomepage.footer.contact')}</p>
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} {...textLinkProps(styles.contactLink)}>
              {t('publicHomepage.footer.contactEmail', { email: PRIVACY_CONTACT_EMAIL })}
            </a>
          </div>
        </div>
        <div {...stylex.props(styles.operator)}>
          <p {...stylex.props(styles.body)}>{t('publicHomepage.footer.operator')}</p>
          <p {...stylex.props(styles.body)}>{t('publicHomepage.footer.audience')}</p>
        </div>
      </footer>
    </div>
  );
}
