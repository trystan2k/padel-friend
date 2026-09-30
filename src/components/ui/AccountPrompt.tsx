import * as stylex from '@stylexjs/stylex';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { styles } from './account-prompt.styles';

type AccountPromptProps = {
  text: ReactNode;
  action: ReactNode;
  to: LinkProps['to'];
  search?: LinkProps['search'];
};

export function AccountPrompt({ text, action, to, search }: AccountPromptProps) {
  return (
    <p {...stylex.props(styles.prompt)}>
      {text}{' '}
      <Link to={to} search={search} {...stylex.props(styles.link)}>
        {action}
      </Link>
    </p>
  );
}
