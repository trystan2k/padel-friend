import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ComponentProps } from 'react';
import { styles } from './surface-card.styles';

type HeroCardProps = ComponentProps<'div'> & { xstyle?: StyleXStyles };

export function HeroCard({ className, style, xstyle, ...props }: HeroCardProps) {
  const stylexProps = stylex.props(styles.card, styles.hero, xstyle);

  return (
    <div
      {...stylexProps}
      {...props}
      className={[stylexProps.className, className].filter(Boolean).join(' ')}
      style={{ ...stylexProps.style, ...style }}
    />
  );
}
