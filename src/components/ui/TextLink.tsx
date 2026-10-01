import * as stylex from '@stylexjs/stylex';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { StyleXStyles } from '@stylexjs/stylex';
import { styles } from './text-link.styles';

type TextLinkProps = {
  to: LinkProps['to'];
  search?: LinkProps['search'];
  children: ReactNode;
  reloadDocument?: boolean;
  xstyle?: StyleXStyles;
};

export function TextLink({ children, xstyle, ...props }: TextLinkProps) {
  return (
    <Link {...props} {...stylex.props(styles.link, xstyle)}>
      {children}
    </Link>
  );
}
