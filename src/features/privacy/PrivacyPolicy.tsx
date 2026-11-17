import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { TextLink } from '../../components/ui/TextLink';
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY_APPROVED,
  PRIVACY_SECTIONS,
  PRIVACY_UPDATED_AT
} from './privacy-content';
import { styles } from './privacy-policy.styles';

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

export function PrivacyPolicy({ approved = PRIVACY_POLICY_APPROVED }: { approved?: boolean }) {
  const { t, i18n } = useTranslation();
  const updated = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(new Date(PRIVACY_UPDATED_AT));

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
        <h1 {...stylex.props(styles.title)}>{t('privacy.title')}</h1>
        <p {...stylex.props(styles.updated)}>{t('privacy.updated', { date: updated })}</p>
      </header>

      {!approved && (
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
                <li key={n}>{t(`privacy.${id}.i${n}`)}</li>
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

      <footer {...stylex.props(styles.footer)}>
        <TextLink to="/login">{t('auth.backToSignIn')}</TextLink>
      </footer>
    </main>
  );
}
