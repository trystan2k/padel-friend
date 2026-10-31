import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: 'var(--space-1)',
    paddingInline: 'var(--space-3)',
    borderRadius: 'var(--radius-8)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase'
  },
  positive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  neutral: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text)' },
  muted: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  danger: {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-red)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-red)'
  },
  guest: { backgroundColor: 'var(--color-amber)', color: 'var(--color-bg)' },
  provisional: {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-amber)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-amber)',
    gap: 'var(--space-2)'
  },
  summary: {
    display: 'inline-flex',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)'
  }
});
