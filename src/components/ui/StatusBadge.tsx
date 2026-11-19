import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ReactNode, HTMLAttributes } from 'react';
import { styles } from './status-badge.styles';

export type StatusBadgeTone = 'positive' | 'neutral' | 'muted' | 'danger' | 'guest' | 'provisional';
export function StatusBadge({
  children,
  tone,
  appearance = 'badge',
  xstyle,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: StatusBadgeTone;
  appearance?: 'badge' | 'emphasis' | 'count' | 'summary';
  xstyle?: StyleXStyles;
}) {
  if (appearance === 'count') return <span {...props}>{children}</span>;
  if (appearance === 'summary')
    return (
      <span {...props} {...stylex.props(styles.summary)}>
        {children}
      </span>
    );
  const toneStyle =
    tone === 'positive'
      ? styles.positive
      : tone === 'guest'
        ? styles.guest
        : tone === 'provisional'
          ? styles.provisional
          : tone === 'danger'
            ? styles.danger
            : tone === 'neutral'
              ? styles.neutral
              : styles.muted;
  // Emphasis stays a bare <strong> unless a tone asks for the chip treatment.
  if (appearance === 'emphasis')
    return tone ? (
      <strong {...props} {...stylex.props(styles.badge, toneStyle, xstyle)}>
        {children}
      </strong>
    ) : (
      <strong {...props}>{children}</strong>
    );
  return (
    <span {...props} {...stylex.props(styles.badge, toneStyle, xstyle)}>
      {children}
    </span>
  );
}
