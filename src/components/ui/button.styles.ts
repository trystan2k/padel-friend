import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    borderWidth: 0,
    borderStyle: 'solid',
    borderRadius: 'var(--radius-12)',
    paddingInline: 'var(--space-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    },
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  primary: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)'
  },
  secondary: {
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-sm)',
    borderColor: 'var(--color-line)',
    color: 'var(--color-text)'
  },
  standard: { minHeight: 'calc(var(--space-40) + var(--space-4))' },
  large: { minHeight: 'calc(var(--space-40) + var(--space-10))' }
});
