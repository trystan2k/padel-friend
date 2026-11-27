import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import brandIcon from '../../../docs/design/padel-friends-app-icon.png';
import { TextLink } from '../../components/ui/TextLink';
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_LEGAL_REVIEW_COMPLETED,
  PRIVACY_SECTIONS,
  PRIVACY_UPDATED_AT
} from './privacy-content';
import { styles } from './privacy-policy.styles';

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

export function PrivacyPolicy({
  legalReviewCompleted = PRIVACY_LEGAL_REVIEW_COMPLETED
}: {
  legalReviewCompleted?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const updated = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(new Date(PRIVACY_UPDATED_AT));

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.brandRow)}>
          <img src={brandIcon} alt="" {...stylex.props(styles.logo)} />
          <span {...stylex.props(styles.brand)}>{t('auth.loginBrand')}</span>
        </div>
        <TextLink to="/" xstyle={styles.back}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...stylex.props(styles.backIcon)}
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          {t('privacy.backHome')}
        </TextLink>
        <h1 {...stylex.props(styles.title)}>{t('privacy.title')}</h1>
        <p {...stylex.props(styles.updated)}>{t('privacy.updated', { date: updated })}</p>
      </header>

      {!legalReviewCompleted && (
        <p role="note" {...stylex.props(styles.notice)}>
          {t('privacy.reviewNotice')}
        </p>
      )}

      {PRIVACY_SECTIONS.map(({ id, paragraphs, items }) => (
        <section key={id} aria-labelledby={`privacy-${id}`} {...stylex.props(styles.section)}>
          <h2 id={`privacy-${id}`} {...stylex.props(styles.sectionTitle)}>
            {t(`privacy.${id}.title`)}
          </h2>
          {range(paragraphs).map((n) => (
            <p key={n} {...stylex.props(styles.paragraph)}>
              {t(`privacy.${id}.p${n}`)}
            </p>
          ))}
          {items > 0 && (
            <ul {...stylex.props(styles.list)}>
              {range(items).map((n) => (
                <li key={n} {...stylex.props(styles.item)}>
                  {t(`privacy.${id}.i${n}`)}
                </li>
              ))}
            </ul>
          )}
          {id === 'contact' && (
            <p {...stylex.props(styles.paragraph)}>
              <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} {...stylex.props(styles.email)}>
                {PRIVACY_CONTACT_EMAIL}
              </a>
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
