import * as stylex from '@stylexjs/stylex';

// Frame Ilxwe: 15px semibold label, 52px control, radius 12, 1.5px line border, 16px value text
// (16px also keeps iOS from zooming on focus). Focus ring comes from control.styles.
export const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  label: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  control: {
    boxSizing: 'border-box',
    width: '100%',
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    paddingInline: 'var(--space-12)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    '::placeholder': { color: 'var(--color-muted)', opacity: 1 },
    ':disabled': { opacity: 0.6, cursor: 'not-allowed' },
    '[aria-invalid="true"]': { borderColor: 'var(--color-red)' }
  },
  helper: {
    margin: 0,
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-comfortable)',
    color: 'var(--color-muted)'
  },
  error: {
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)',
    color: 'var(--color-red)'
  }
});
