import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  badge: {
    alignSelf: 'flex-start',
    padding: 'var(--space-5) var(--space-9)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  }
});
