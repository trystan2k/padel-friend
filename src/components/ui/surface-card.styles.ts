import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-9)',
    padding: 'var(--space-13)',
    borderRadius: 'var(--radius-15)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  hero: {
    gap: 'var(--space-7)',
    padding: 'var(--space-17)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-green-deep)',
    color: 'var(--color-hero-copy)'
  }
});
