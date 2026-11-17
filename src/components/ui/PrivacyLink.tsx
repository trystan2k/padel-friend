import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { TextLink } from './TextLink';
import { styles } from './privacy-link.styles';

export function PrivacyLink() {
  const { t } = useTranslation();
  return (
    <div {...stylex.props(styles.row)}>
      <TextLink to="/privacy">{t('auth.privacyLink')}</TextLink>
    </div>
  );
}
