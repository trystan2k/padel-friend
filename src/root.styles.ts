import * as stylex from '@stylexjs/stylex';

export const rootStyles = stylex.create({
  pageHeader: {
    minWidth: 0,
    paddingInlineEnd: 'calc(var(--space-40) * 2 + var(--space-8) * 3)',
    overflowWrap: 'anywhere'
  },
  controls: {
    position: 'absolute',
    top: 'calc(var(--space-18) + var(--space-8))',
    right: 'var(--space-18)',
    display: 'flex',
    gap: 'var(--space-8)'
  },
  chip: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: '50%',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface-2)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-11)',
    color: 'var(--color-muted)'
  },
  chipText: { pointerEvents: 'none', textTransform: 'uppercase' },
  locale: {
    position: 'absolute',
    inset: 0,
    opacity: 0,
    cursor: 'pointer',
    appearance: 'none',
    boxSizing: 'border-box',
    minBlockSize: 'calc(var(--space-40) + var(--space-4))',
    inlineSize: '100%'
  },
  focusChip: {
    ':has(:focus-visible)': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  localeText: { color: 'var(--color-text)' }
});
