import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ComponentProps } from 'react';
import { styles } from './surface-card.styles';

type SurfaceCardProps = ComponentProps<'div'> & { xstyle?: StyleXStyles };

export function SurfaceCard({ className, style, xstyle, ...props }: SurfaceCardProps) {
  const stylexProps = stylex.props(styles.card, xstyle);

  return (
    <div
      {...stylexProps}
      {...props}
      className={[stylexProps.className, className].filter(Boolean).join(' ')}
      style={{ ...stylexProps.style, ...style }}
    />
  );
}
