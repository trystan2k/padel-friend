import * as stylex from '@stylexjs/stylex';

export const pwaStyles = stylex.create({
  install: {
    boxSizing: 'border-box',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    fontFamily: 'var(--font-family-body)'
  },
  installTitle: {
    margin: 0,
    color: 'var(--color-amber)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase'
  },
  installedTitle: { color: 'var(--color-green)' },
  copy: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere'
  },
  alert: { color: 'var(--color-red)' },
  action: {
    minHeight: '44px',
    marginBlockStart: 'var(--space-8)',
    paddingInline: 'var(--space-16)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-surface)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-text)',
      outlineOffset: 'var(--space-2)'
    },
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  banner: {
    position: 'fixed',
    insetInline: 'var(--space-16)',
    insetBlockEnd: 'var(--space-16)',
    zIndex: 30,
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  secondary: {
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)'
  }
});
