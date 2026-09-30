import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { styles } from './step-badge.styles';

export function StepBadge({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.badge)}>{children}</span>;
}
