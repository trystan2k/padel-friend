import * as stylex from '@stylexjs/stylex';

export const matchInvitationStyles = stylex.create({
  panel: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-5)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  title: { margin: 0, fontFamily: 'var(--font-family-heading)', fontSize: 'var(--font-size-18)' },
  copy: { margin: 0, color: 'var(--color-text)' },
  status: { display: 'grid', gap: 'var(--space-3)' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }
});
