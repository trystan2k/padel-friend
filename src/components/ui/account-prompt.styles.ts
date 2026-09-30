import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  prompt: {
    margin: 0,
    textAlign: 'center',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  link: {
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  }
});
