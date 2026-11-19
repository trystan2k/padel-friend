import * as stylex from '@stylexjs/stylex';

// Frames wzWLt / EGb2g divider: 12px gap, 14px regular label, hairline rules.
export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)'
  },
  rule: { flex: 1, height: 'var(--space-1)', backgroundColor: 'var(--color-hairline)' }
});
