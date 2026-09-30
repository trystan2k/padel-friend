import { Field } from '@base-ui/react/field';
import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { styles } from './text-field.styles';

export type TextFieldProps = Omit<ComponentProps<typeof Field.Control>, 'children' | 'size'> & {
  label: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  xstyle?: StyleXStyles;
};

export function TextField({
  label,
  helper,
  error,
  id,
  className,
  style,
  'aria-describedby': describedBy,
  'aria-invalid': callerInvalid,
  xstyle,
  ...controlProps
}: TextFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const description = [describedBy, helper ? helperId : undefined, error ? errorId : undefined]
    .filter(Boolean)
    .join(' ');
  const invalid = Boolean(error) || Boolean(callerInvalid && callerInvalid !== 'false');
  const {
    className: stylexClassName,
    style: stylexStyle,
    ...stylexProps
  } = stylex.props(styles.control, xstyle);
  const mergedClassName =
    typeof className === 'function'
      ? (state: Parameters<typeof className>[0]) =>
          [stylexClassName, className(state)].filter(Boolean).join(' ')
      : [stylexClassName, className].filter(Boolean).join(' ');
  const mergedStyle =
    typeof style === 'function'
      ? (state: Parameters<typeof style>[0]) => ({ ...stylexStyle, ...style(state) })
      : { ...stylexStyle, ...style };

  const control = (
    <Field.Control
      {...stylexProps}
      {...controlProps}
      id={controlId}
      aria-invalid={error ? true : callerInvalid}
      aria-describedby={description || undefined}
      className={mergedClassName}
      style={mergedStyle}
    />
  );

  return (
    <Field.Root invalid={invalid} {...stylex.props(styles.root)}>
      <Field.Label htmlFor={controlId} {...stylex.props(styles.label)}>
        {label}
      </Field.Label>
      {control}
      {helper && (
        <Field.Description id={helperId} {...stylex.props(styles.helper)}>
          {helper}
        </Field.Description>
      )}
      {error && (
        <Field.Error id={errorId} match role="alert" {...stylex.props(styles.error)}>
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
}
