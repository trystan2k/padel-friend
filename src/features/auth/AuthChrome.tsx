import * as stylex from '@stylexjs/stylex';
import type { LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TextLink } from '../../components/ui/TextLink';
import { chromeStyles as styles } from './auth-chrome.styles';

type AuthTopBarProps = {
  title: string;
  back?: { to: LinkProps['to']; search?: LinkProps['search'] };
};

export function AuthTopBar({ title, back }: AuthTopBarProps) {
  const { t } = useTranslation();
  return (
    <div {...stylex.props(styles.topBar)}>
      {back ? (
        <TextLink to={back.to} search={back.search} xstyle={styles.back}>
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span {...stylex.props(styles.srOnly)}>{t('auth.back')}</span>
        </TextLink>
      ) : (
        <span {...stylex.props(styles.backSlot)} />
      )}
      <span {...stylex.props(styles.barTitle)}>{title}</span>
      <span {...stylex.props(styles.actionSlot)} />
    </div>
  );
}

export function AuthActionBar({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actionBar)}>{children}</div>;
}
