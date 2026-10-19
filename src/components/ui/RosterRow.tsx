import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { styles } from './roster-row.styles';
export function RosterRow({
  name,
  children,
  highlighted = false,
  appearance = 'roster'
}: {
  name: ReactNode;
  children?: ReactNode;
  highlighted?: boolean;
  appearance?: 'roster' | 'request-header';
}) {
  return (
    <div
      {...stylex.props(
        appearance === 'roster' ? styles.roster : styles.header,
        highlighted && styles.highlighted
      )}
    >
      <p {...stylex.props(styles.name)}>{name}</p>
      {children}
    </div>
  );
}
