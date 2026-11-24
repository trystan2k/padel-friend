import * as stylex from '@stylexjs/stylex';

export const rootStyles = stylex.create({
  pageHeader: {
    minWidth: 0,
    // Reserve room for the global chips only where they intersect the widest (640px) content column:
    // viewports under 640px + 2 x (chips 96px + 18px inset).
    paddingInlineEnd: {
      default: 0,
      '@media (max-width: 879px)': 'calc(var(--space-40) * 2 + var(--space-8) * 3)'
    },
    overflowWrap: 'anywhere'
  },
  controls: {
    position: 'absolute',
    top: 'calc(var(--space-18) + var(--space-8))',
    right: 'var(--space-18)',
    display: {
      default: 'flex',
      [stylex.when.ancestor(':has([data-route-chrome="navigation"])')]: 'none'
    },
    gap: 'var(--space-8)'
  },
  homeControls: {
    top: 'calc(var(--space-16) + env(safe-area-inset-top, 0px))',
    right:
      'max(calc(var(--space-12) * 2), calc((100% - var(--space-40) * 12) / 2 + var(--space-12) * 2), env(safe-area-inset-right, 0px))'
  },
  homeChip: {
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  homeIcon: { display: 'block', width: 'var(--space-20)', height: 'var(--space-20)' },
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
