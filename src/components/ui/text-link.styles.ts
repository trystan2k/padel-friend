import * as stylex from '@stylexjs/stylex';

// Frame QFH5u: 15px bold green label. Links stay inline-sized, so the touch target is the 44px
// floor rather than the 52px control height.
export const styles = stylex.create({
  link: {
    display: 'inline-flex',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    alignItems: 'center',
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none'
  }
});
