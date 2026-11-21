import * as stylex from '@stylexjs/stylex';

// Frame ZthyR: the password rules sit under both fields as two 14px muted lines with a state mark.
export const styles = stylex.create({
  rules: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  rule: { display: 'flex', gap: 'var(--space-6)' },
  ruleMet: { color: 'var(--color-green-ink)' }
});
