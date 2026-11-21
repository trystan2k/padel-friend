import * as stylex from '@stylexjs/stylex';

// Clubhouse invitation card (frame Fyhbv): radius-18 card, stacked full-width actions.
export const matchInvitationStyles = stylex.create({
  panel: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-10)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  copy: { margin: 0, color: 'var(--color-text)', fontSize: 'var(--font-size-14)' },
  hint: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-13)' },
  status: { display: 'grid', gap: 'var(--space-6)' },
  actions: { display: 'grid', gap: 'var(--space-8)' }
});
