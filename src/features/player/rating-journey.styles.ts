import * as stylex from '@stylexjs/stylex';

// Frames lNj83 / DtbIE / JYWDi (+ dark twins): 28/800 heading, a 20px card with the 40/800 level,
// a green or red change line, a 144px bar plot on a 3-5 tick axis, a swatch legend, then a
// "Recent games" card of hairline-divided rows. Empty and error states are their own cards.
// Tokens only; every target is at least 44px.
const PLOT = 'calc(var(--space-40) * 3 + var(--space-20) + var(--space-4))';

export const journey = stylex.create({
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)', minWidth: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    color: 'var(--color-text)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  card: { minWidth: 0, overflowWrap: 'anywhere' },
  headline: { display: 'flex', alignItems: 'flex-end', gap: 'var(--space-10)', flexWrap: 'wrap' },
  level: {
    margin: 0,
    fontSize: 'calc(var(--font-size-20) * 2)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    fontVariantNumeric: 'tabular-nums'
  },
  change: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    paddingBlockEnd: 'var(--space-4)'
  },
  changeUp: { color: 'var(--color-green)' },
  changeDown: { color: 'var(--color-red)' },
  changeFlat: { color: 'var(--color-muted)' },
  caption: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  chart: { display: 'flex', gap: 'var(--space-10)' },
  axis: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    height: PLOT,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    fontVariantNumeric: 'tabular-nums'
  },
  plot: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', flex: 1, minWidth: 0 },
  bars: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 'var(--space-8)',
    height: PLOT,
    paddingInline: 'var(--space-1)',
    borderBlockEndWidth: 'var(--border-width-sm)',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-line)'
  },
  bar: {
    flex: '1 1 0',
    minWidth: 0,
    borderStartStartRadius: 'var(--space-4)',
    borderStartEndRadius: 'var(--space-4)',
    backgroundColor: 'var(--color-line)'
  },
  barLatest: { backgroundColor: 'var(--color-green)' },
  dates: { display: 'flex', gap: 'var(--space-8)', paddingInline: 'var(--space-1)' },
  date: {
    flex: '1 1 0',
    minWidth: 0,
    textAlign: 'center',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  legend: { display: 'flex', alignItems: 'center', gap: 'var(--space-8)' },
  swatch: {
    flexShrink: 0,
    width: 'var(--space-12)',
    height: 'var(--space-12)',
    borderRadius: 'var(--space-3)',
    backgroundColor: 'var(--color-green)'
  },
  recent: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  recentTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  row: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  rowDivided: {
    paddingBlockStart: 'var(--space-12)',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  rowLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)',
    minWidth: 0
  },
  rowTitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  rowValue: {
    flexShrink: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    fontVariantNumeric: 'tabular-nums'
  },
  rowMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-4) var(--space-10)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)'
  },
  rowCopy: { margin: 0 },
  tile: {
    display: 'grid',
    placeItems: 'center',
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)'
  },
  tileIcon: { width: 'var(--space-20)', height: 'var(--space-20)' },
  emptyTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  emptyBody: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  divider: {
    height: 'var(--border-width-sm)',
    border: 0,
    margin: 0,
    backgroundColor: 'var(--color-hairline)'
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-red-soft)',
    color: 'var(--color-red)'
  },
  bannerIcon: { flexShrink: 0, width: 'var(--space-18)', height: 'var(--space-18)' },
  bannerText: {
    margin: 0,
    flex: 1,
    minWidth: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  actionIcon: { width: 'var(--space-16)', height: 'var(--space-16)', flexShrink: 0 }
});
