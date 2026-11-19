import * as stylex from '@stylexjs/stylex';

// Frame RMese: surface card, radius 20, 1px hairline border, 16px padding, 12px slot gap.
// The hero keeps the deep-green surface and legacy hero-copy tone on purpose: hero consumers still
// style their children with the legacy hero tokens, so the surface must stay a fixed dark green in
// both themes until the page units migrate them.
export const styles = stylex.create({
  card: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    padding: 'var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  hero: {
    gap: 'var(--space-7)',
    padding: 'var(--space-17)',
    borderColor: 'var(--color-green-deep)',
    backgroundColor: 'var(--color-green-deep)',
    color: 'var(--color-hero-copy)'
  }
});
