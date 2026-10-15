import * as stylex from '@stylexjs/stylex';

export const inboxStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-4)', width: '100%' },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  body: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  notice: { color: 'var(--color-muted)' }
});
