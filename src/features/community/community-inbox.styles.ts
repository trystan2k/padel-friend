import * as stylex from '@stylexjs/stylex';

export const inboxStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-12)', width: '100%' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)'
  },
  card: { gap: 'var(--space-12)', padding: 'var(--space-14)' },
  body: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  notice: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' }
});
