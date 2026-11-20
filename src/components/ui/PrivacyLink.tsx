import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { TextLink, textLinkProps } from './TextLink';
import { styles } from './privacy-link.styles';

export function PrivacyLink({ canonical = false }: { canonical?: boolean }) {
  const { t } = useTranslation();
  if (canonical) {
    // Use the same literal URL that Google OAuth Branding links to.
    return (
      <a href="/privacy" {...textLinkProps()}>
        {t('auth.privacyLink')}
      </a>
    );
  }
  return (
    <div {...stylex.props(styles.row)}>
      <TextLink to="/privacy">{t('auth.privacyLink')}</TextLink>
    </div>
  );
}
