import * as stylex from '@stylexjs/stylex';
import type { LinkProps } from '@tanstack/react-router';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { TextLink } from './TextLink';
import { styles } from './account-prompt.styles';

type AccountPromptProps = {
  text: ReactNode;
  action: ReactNode;
  to: LinkProps['to'];
  search?: LinkProps['search'];
  xstyle?: StyleXStyles;
};

export function AccountPrompt({ text, action, to, search, xstyle }: AccountPromptProps) {
  return (
    <p {...stylex.props(styles.prompt, xstyle)}>
      {text}{' '}
      <TextLink to={to} search={search}>
        {action}
      </TextLink>
    </p>
  );
}
