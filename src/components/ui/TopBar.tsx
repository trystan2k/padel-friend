import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { controlStyles } from './control.styles';
import { topBarStyles as styles } from './top-bar.styles';

type TopBarProps = {
  title: ReactNode;
  /** Set when the heading must be focusable (restoring focus after a nested view closes). */
  headingId?: string;
  /** Same, for screens that move focus to the heading through a ref. */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * 'p' when the page body owns the h1 (frames that repeat a section name in the bar above a
   * larger page title), so the document keeps exactly one h1.
   */
  titleAs?: 'h1' | 'p';
  /** Localized, already-translated accessible name; the chevron itself is decorative. */
  back?: {
    to: LinkProps['to'];
    params?: LinkProps['params'];
    search?: LinkProps['search'];
    label: string;
  };
  /** A button back (closing an in-page editor) instead of a route link; same chevron and target. */
  backAction?: { label: string; onClick: () => void; disabled?: boolean };
  /** End slot content, usually a TopBarAction. The start slot mirrors its minimum width. */
  trailing?: ReactNode;
  xstyle?: StyleXStyles;
};

/**
 * Shared Clubhouse top bar: centered title between two equal side slots. Pages that render it own
 * the top chrome, so they mark their main with data-route-chrome="navigation" (see root.styles).
 */
export function TopBar({
  title,
  headingId,
  headingRef,
  titleAs = 'h1',
  back,
  backAction,
  trailing,
  xstyle
}: TopBarProps) {
  const focusable = headingId !== undefined || headingRef !== undefined;
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
            <BackChevron />
          </Link>
        )}
        {backAction && (
          <button
            type="button"
            aria-label={backAction.label}
            disabled={backAction.disabled}
            onClick={backAction.onClick}
            {...stylex.props(styles.back, styles.backButton, controlStyles.focusRing)}
          >
            <BackChevron />
          </button>
        )}
      </div>
      {titleAs === 'p' ? (
        <p {...stylex.props(styles.title)}>{title}</p>
      ) : (
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={focusable ? -1 : undefined}
          {...stylex.props(styles.title, focusable && styles.headingFocus)}
        >
          {title}
        </h1>
      )}
      <div {...stylex.props(styles.endSlot)}>{trailing}</div>
    </header>
  );
}

function BackChevron() {
  return (
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
  );
}

/** The same end-slot action as a route link, for actions that navigate instead of acting in place. */
export function TopBarActionLink({
  xstyle,
  ...props
}: LinkProps & { xstyle?: StyleXStyles; children?: ReactNode }) {
  return <Link {...props} {...stylex.props(styles.action, controlStyles.focusRing, xstyle)} />;
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
