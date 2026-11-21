import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { LevelReviewStatus } from './level-review-contracts';
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';

const CHIP = {
  pending: [c.toneAmber, '◷'],
  under_review: [c.toneAmber, '◷'],
  approved: [c.toneGreen, '✓'],
  rejected: [c.toneRed, '×'],
  canceled: [c.toneMuted, '–']
} as const satisfies Record<LevelReviewStatus, readonly [unknown, string]>;

/** Pill status chip with a decorative glyph (frames A9f626 / SCPeI / Y7NRH); the label carries the state. */
export function LevelReviewStatusChip({ status }: { status: LevelReviewStatus }) {
  const { t } = useTranslation();
  const [tone, glyph] = CHIP[status];
  return (
    <span {...stylex.props(c.chip, tone)}>
      <span aria-hidden="true">{glyph}</span>
      {t(`levelReview.status.${status}`)}
    </span>
  );
}

/** Initials avatar: the first letters of the first two words, uppercased for the viewer's locale. */
export function LevelReviewAvatar({
  name,
  locale,
  large
}: {
  name: string;
  locale: string;
  large?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase(locale);
  return (
    <span aria-hidden="true" {...stylex.props(c.avatar, large && c.avatarLarge)}>
      {initials}
    </span>
  );
}

/** Decorative arrow-up-right leading the 44px link rows. */
export function LevelReviewLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(c.linkIcon)}
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
