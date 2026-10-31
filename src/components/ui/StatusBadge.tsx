import * as stylex from '@stylexjs/stylex';
import type { ReactNode, HTMLAttributes } from 'react';
import { styles } from './status-badge.styles';

export type StatusBadgeTone = 'positive' | 'neutral' | 'muted' | 'danger' | 'guest' | 'provisional';
export function StatusBadge({
  children,
  tone,
  appearance = 'badge',
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: StatusBadgeTone;
  appearance?: 'badge' | 'emphasis' | 'count' | 'summary';
}) {
  if (appearance === 'emphasis') return <strong {...props}>{children}</strong>;
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
  return (
    <span {...props} {...stylex.props(styles.badge, toneStyle)}>
      {children}
    </span>
  );
}
