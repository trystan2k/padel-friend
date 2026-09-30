import { Button as BaseButton } from '@base-ui/react/button';
import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ComponentProps } from 'react';
import { styles } from './button.styles';

type ButtonProps = ComponentProps<typeof BaseButton> & {
  variant?: 'primary' | 'secondary';
  size?: 'standard' | 'large';
  busy?: boolean;
  xstyle?: StyleXStyles;
};

export function Button({
  variant = 'primary',
  size = 'standard',
  busy = false,
  disabled,
  type = 'button',
  xstyle,
  className,
  style,
  ...props
}: ButtonProps) {
  const {
    className: stylexClassName,
    style: stylexStyle,
    ...stylexProps
  } = stylex.props(styles.base, styles[variant], styles[size], xstyle);
  const mergedClassName =
    typeof className === 'function'
      ? (state: Parameters<typeof className>[0]) =>
          [stylexClassName, className(state)].filter(Boolean).join(' ')
      : [stylexClassName, className].filter(Boolean).join(' ');
  const mergedStyle =
    typeof style === 'function'
      ? (state: Parameters<typeof style>[0]) => ({ ...stylexStyle, ...style(state) })
      : { ...stylexStyle, ...style };

  return (
    <BaseButton
      {...stylexProps}
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={mergedClassName}
      style={mergedStyle}
    />
  );
}
