import * as stylex from '@stylexjs/stylex';

// Frame EGb2g: three-segment progress, step label, then the credential fields; the CTA and the
// profile hand-off note live in the sticky action bar.
export const styles = stylex.create({
  progress: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)' },
  segment: {
    flex: 1,
    height: 'var(--space-6)',
    borderRadius: 'var(--space-3)',
    backgroundColor: 'var(--color-surface-2)'
  },
  segmentActive: { backgroundColor: 'var(--color-green)' },
  step: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  prompt: { marginBlockStart: 'var(--space-2)' }
});
