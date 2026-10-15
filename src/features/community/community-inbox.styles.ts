import * as stylex from '@stylexjs/stylex';

export const inboxStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-4)', width: '100%' },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-card)'
  },
  body: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  notice: { color: 'var(--color-text-secondary)' }
});
