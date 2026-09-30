import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  rule: { flex: 1, height: 'var(--space-1)', backgroundColor: 'var(--color-line)' }
});
