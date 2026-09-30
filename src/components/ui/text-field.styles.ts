import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' },
  label: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  control: {
    boxSizing: 'border-box',
    width: '100%',
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    paddingInline: 'var(--space-12)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    '::placeholder': { color: 'var(--color-muted)', opacity: 1 },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    },
    ':disabled': { opacity: 0.6, cursor: 'not-allowed' },
    '[aria-invalid="true"]': { borderColor: 'var(--color-red)' }
  },
  helper: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  error: { fontSize: 'var(--font-size-12)', color: 'var(--color-red)' }
});
