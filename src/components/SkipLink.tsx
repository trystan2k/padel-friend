import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { accessibilityStyles as s } from './accessibility.styles';

export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      {...stylex.props(s.skip)}
      onClick={() => document.getElementById('main-content')?.focus()}
    >
      {t('accessibility.skipToContent')}
    </a>
  );
}
