import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-8))';
const actionSlot = 'calc(var(--space-40) + var(--space-20) + var(--space-12))';

// Clubhouse top bar (frames eYIgj family, auth bars): 56px row, 8px side inset, 48px back target,
// centered 17/700 title between two equal side slots, and a text action (15/700 green) on the end.
// The bar owns the whole top chrome, so routes that use it also opt into data-route-chrome="navigation"
// and the global language/theme chips step aside instead of being reserved for.
export const topBarStyles = stylex.create({
  bar: {
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: '1fr minmax(0, auto) 1fr',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingInlineStart: 'max(var(--space-8), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-8), env(safe-area-inset-right))',
    paddingBlockStart: 'env(safe-area-inset-top)'
  },
  startSlot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Mirrors the end slot's minimum, so a long title stays centered between equal columns.
    minWidth: actionSlot
  },
  endSlot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: actionSlot
  },
  back: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: target,
    height: target,
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)'
  },
  backButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: { default: 'pointer', ':disabled': 'not-allowed' }
  },
  icon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  title: {
    margin: 0,
    minWidth: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    textAlign: 'center',
    overflowWrap: 'anywhere'
  },
  // A heading that only takes programmatic focus (screen-reader announcement) is not a control.
  headingFocus: { outline: 'none' },
  action: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: target,
    minWidth: target,
    paddingInline: 'var(--space-8)',
    borderWidth: 0,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'transparent',
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'anywhere'
  }
});
