import * as stylex from '@stylexjs/stylex';

// Clubhouse chips: 13px semibold sentence-case. Casing belongs to the translated copy, so there is
// no text-transform or tracking here. Soft-green chips carry green-ink for contrast.
export const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  positive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  neutral: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text)' },
  muted: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  danger: {
    backgroundColor: 'var(--color-red-soft)',
    color: 'var(--color-red)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-red)'
  },
  guest: { backgroundColor: 'var(--color-amber)', color: 'var(--color-bg)' },
  provisional: {
    backgroundColor: 'var(--color-amber-soft)',
    color: 'var(--color-amber)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-amber)',
    gap: 'var(--space-4)'
  },
  summary: {
    display: 'inline-flex',
    padding: 'var(--space-4) var(--space-10)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-13)'
  }
});
