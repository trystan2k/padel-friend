import * as stylex from '@stylexjs/stylex';

// Claim frames LzVgj / j6753 / uo9wF: 15px bold label, 14px bold value, four 4px segments (4px gap).
export const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
  label: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-8)' },
  title: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  value: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  meter: { display: 'flex', gap: 'var(--space-4)' },
  segment: {
    flex: 1,
    height: 'var(--space-4)',
    borderRadius: 'var(--radius-5)',
    backgroundColor: 'var(--color-surface-2)'
  },
  red: { backgroundColor: 'var(--color-red)' },
  amber: { backgroundColor: 'var(--color-amber)' },
  green: { backgroundColor: 'var(--color-green)' },
  valueRed: { color: 'var(--color-red)' },
  valueAmber: { color: 'var(--color-amber)' },
  valueGreen: { color: 'var(--color-green)' }
});
