import * as stylex from '@stylexjs/stylex';

// Clubhouse control language shared by interactive primitives: 52px minimum control height and the
// unified focus ring tokens (frames B3Uqv, Ilxwe, QFH5u).
export const controlStyles = stylex.create({
  size: { minHeight: 'calc(var(--space-40) + var(--space-12))' },
  focusRing: {
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  }
});
