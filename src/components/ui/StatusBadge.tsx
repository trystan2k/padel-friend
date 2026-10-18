import * as stylex from '@stylexjs/stylex';
import type { ReactNode, HTMLAttributes } from 'react';
import { styles } from './status-badge.styles';

type Tone = 'playing' | 'reserve' | 'muted' | 'danger' | 'guest';
export function StatusBadge({
  children,
  tone,
  appearance = 'badge',
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: Tone;
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
    tone === 'playing'
      ? styles.playing
      : tone === 'guest'
        ? styles.guest
        : tone === 'danger'
          ? styles.danger
          : tone === 'reserve'
            ? styles.reserve
            : styles.muted;
  return (
    <span {...props} {...stylex.props(styles.badge, toneStyle)}>
      {children}
    </span>
  );
}
