import * as stylex from '@stylexjs/stylex';

export const matchLeagueImpactStyles = stylex.create({
  panel: {
    display: 'grid',
    gap: 'var(--space-8)',
    minWidth: 0,
    margin: 0,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-line-height-body)'
  },
  title: { margin: 0, fontSize: 'var(--font-size-13)', fontWeight: 'var(--font-weight-semibold)' },
  list: { display: 'grid', gap: 'var(--space-4)', margin: 0, minWidth: 0 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', minWidth: 0 },
  term: { margin: 0, color: 'var(--color-muted)' },
  value: {
    margin: 0,
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontWeight: 'var(--font-weight-semibold)'
  },
  note: { margin: 0, color: 'var(--color-muted)' }
});
