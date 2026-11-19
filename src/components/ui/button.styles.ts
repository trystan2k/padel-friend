import * as stylex from '@stylexjs/stylex';

// Frame B3Uqv: 52px tall, radius 14, 16px bold label. Secondary and destructive keep the 1.5px
// outline from the state-board buttons; foreground on green uses on-green, never the page text token.
export const styles = stylex.create({
  base: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    borderWidth: 0,
    borderStyle: 'solid',
    borderRadius: 'var(--radius-14)',
    paddingBlock: 'var(--space-12)',
    paddingInline: 'var(--space-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    textAlign: 'center',
    cursor: 'pointer',
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 },
    '[aria-busy="true"]': { cursor: 'progress' }
  },
  primary: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)'
  },
  secondary: {
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-md)',
    borderColor: 'var(--color-line)',
    color: 'var(--color-text)'
  },
  destructive: {
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-md)',
    borderColor: 'var(--color-red)',
    color: 'var(--color-red)'
  },
  large: { minHeight: 'calc(var(--space-40) + var(--space-16))' }
});
