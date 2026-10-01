import { Separator } from '@base-ui/react/separator';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { styles } from './or-divider.styles';

export function OrDivider({ label }: { label: ReactNode }) {
  return (
    <div {...stylex.props(styles.root)}>
      <Separator aria-hidden="true" {...stylex.props(styles.rule)} />
      <span>{label}</span>
      <Separator aria-hidden="true" {...stylex.props(styles.rule)} />
    </div>
  );
}
