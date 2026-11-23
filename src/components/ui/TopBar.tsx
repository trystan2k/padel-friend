import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ComponentProps, ReactNode } from 'react';
import { controlStyles } from './control.styles';
import { topBarStyles as styles } from './top-bar.styles';

type TopBarProps = {
  title: ReactNode;
  /** Set when the heading must be focusable (restoring focus after a nested view closes). */
  headingId?: string;
  /** Localized, already-translated accessible name; the chevron itself is decorative. */
  back?: {
    to: LinkProps['to'];
    params?: LinkProps['params'];
    search?: LinkProps['search'];
    label: string;
  };
  /** End slot content, usually a TopBarAction. The start slot mirrors its minimum width. */
  trailing?: ReactNode;
  xstyle?: StyleXStyles;
};

/**
 * Shared Clubhouse top bar: centered title between two equal side slots. Pages that render it own
 * the top chrome, so they mark their main with data-route-chrome="navigation" (see root.styles).
 */
export function TopBar({ title, headingId, back, trailing, xstyle }: TopBarProps) {
  const focusable = headingId !== undefined;
  return (
    <header {...stylex.props(styles.bar, xstyle)}>
      <div {...stylex.props(styles.startSlot)}>
        {back && (
          <Link
            to={back.to}
            params={back.params}
            search={back.search}
            aria-label={back.label}
            {...stylex.props(styles.back, controlStyles.focusRing)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              {...stylex.props(styles.icon)}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
      </div>
      <h1
        id={headingId}
        tabIndex={focusable ? -1 : undefined}
        {...stylex.props(styles.title, focusable && styles.headingFocus)}
      >
        {title}
      </h1>
      <div {...stylex.props(styles.endSlot)}>{trailing}</div>
    </header>
  );
}

export function TopBarAction({
  xstyle,
  type = 'button',
  ...props
}: ComponentProps<'button'> & {
  xstyle?: StyleXStyles;
}) {
  return (
    <button
      type={type}
      {...props}
      {...stylex.props(styles.action, controlStyles.focusRing, xstyle)}
    />
  );
}
