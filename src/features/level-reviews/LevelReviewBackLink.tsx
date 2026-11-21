import * as stylex from '@stylexjs/stylex';
import { Link, type LinkProps } from '@tanstack/react-router';
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';

/** 48px top-bar back link with a decorative 24px chevron (frames qWosG / OKYtp); `label` names it. */
export function LevelReviewBackLink({ to, label }: { to: LinkProps['to']; label: string }) {
  return (
    <Link to={to} aria-label={label} {...stylex.props(c.backLink)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...stylex.props(c.backIcon)}
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </Link>
  );
}
