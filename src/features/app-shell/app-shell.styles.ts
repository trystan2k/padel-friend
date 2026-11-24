import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-16))';
// Frame "Tab bar": 6px top pad + 56px controls + the bottom inset, never below the home-indicator.
const barHeight =
  'calc(var(--space-6) + var(--space-40) + var(--space-16) + max(var(--space-18), env(safe-area-inset-bottom)))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

// Full-screen forms inside a tab destination (the profile edit screen draws its own sticky action
// bar) mark their main with data-app-chrome="hidden"; the tab bar and its clearance step aside.
export const appShellStyles = stylex.create({
  bar: {
    display: {
      default: null,
      [stylex.when.ancestor(':has([data-app-chrome="hidden"])')]: 'none'
    },
    position: 'fixed',
    insetInline: 0,
    insetBlockEnd: 0,
    boxSizing: 'border-box',
    zIndex: 5,
    paddingBlockStart: 'var(--space-6)',
    paddingBlockEnd: 'max(var(--space-18), env(safe-area-inset-bottom))',
    // Inline room keeps the focus ring of the edge tabs inside the scroll container.
    paddingInline: 'var(--space-4)',
    // Below five targets of width the row scrolls instead of shrinking tabs under 44px.
    overflowX: 'auto',
    scrollbarWidth: 'none',
    backgroundColor: 'var(--color-surface)',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  list: {
    display: 'flex',
    alignItems: 'center',
    margin: 0,
    padding: 0,
    marginInline: 'auto',
    listStyle: 'none',
    maxWidth: 'calc(var(--space-40) * 12)'
  },
  item: {
    flex: 1,
    flexShrink: 0,
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    justifyContent: 'center'
  },
  createItem: { minWidth: target },
  tab: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-3)',
    width: '100%',
    minHeight: target,
    paddingInline: 'var(--space-2)',
    fontFamily: 'var(--font-family-body)',
    // Labels stay on one line (frames); the step-down below 360px fits the longest pt-BR/es words.
    fontSize: {
      default: 'var(--font-size-12)',
      '@media (max-width: 359px)': 'var(--font-size-10)'
    },
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'normal',
    borderRadius: 'var(--radius-12)',
    ':focus-visible': focusRing
  },
  tabActive: { color: 'var(--color-green)' },
  create: {
    boxSizing: 'border-box',
    display: 'grid',
    placeItems: 'center',
    width: target,
    height: target,
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    ':focus-visible': focusRing
  },
  icon: { width: 'var(--space-20)', height: 'var(--space-20)', flexShrink: 0 },
  createIcon: {
    width: 'calc(var(--space-20) + var(--space-6))',
    height: 'calc(var(--space-20) + var(--space-6))'
  },
  clearance: {
    height: barHeight,
    display: {
      default: null,
      [stylex.when.ancestor(':has([data-app-chrome="hidden"])')]: 'none'
    }
  },
  // Focused fields and anchors scroll clear of the fixed bar (WCAG 2.4.11).
  documentInset: {
    scrollPaddingBlockEnd: {
      default: null,
      ':has([data-app-nav]):not(:has([data-app-chrome="hidden"]))': barHeight
    }
  }
});
