import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  rule: { flex: 1, height: 'var(--space-1)', backgroundColor: 'var(--color-line)' }
});
