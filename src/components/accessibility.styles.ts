import * as stylex from '@stylexjs/stylex';

export const accessibilityStyles = stylex.create({
  skip: {
    position: 'absolute',
    insetInlineStart: 'var(--space-8)',
    insetBlockStart: 'var(--space-8)',
    transform: 'translateY(-200%)',
    zIndex: 100,
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    ':focus': {
      transform: 'translateY(0)',
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  content: { minWidth: 0 },
  notice: {
    display: 'block',
    margin: 0,
    padding: 'var(--space-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)'
  }
});
