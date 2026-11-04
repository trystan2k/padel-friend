import * as stylex from '@stylexjs/stylex';

// Pencil "Rating journey" (profile frame vARtQ): section heading, progression card with a
// line plot, recent-matches card with outcome chip + signed change. Result screens reuse the
// same rows for the per-player rating changes. Tokens only.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const rating = stylex.create({
  journey: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
  journeyHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-6)',
    minHeight: 'calc(var(--space-20) + var(--space-17))'
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)'
  },
  subheading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)'
  },
  scope: {
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-green)',
    textTransform: 'uppercase'
  },
  card: { minWidth: 0, overflowWrap: 'anywhere' },
  copy: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  strong: { fontSize: 'var(--font-size-12)', fontWeight: 'var(--font-weight-semibold)' },
  emptyState: { display: 'flex', alignItems: 'center', gap: 'var(--space-9)' },
  emptyIcon: { fontSize: 'var(--font-size-17)', color: 'var(--color-muted)', flexShrink: 0 },
  stateCopy: { display: 'grid', gap: 'var(--space-3)', minWidth: 0 },
  stateTitle: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' },

  // Chart
  plot: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 'var(--space-6)',
    alignItems: 'stretch'
  },
  axis: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11)',
    fontVariantNumeric: 'tabular-nums'
  },
  svg: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' },
  gridLine: {
    stroke: 'var(--color-line)',
    strokeWidth: 'var(--border-width-sm)'
  },
  area: { fill: 'var(--color-green)', fillOpacity: 0.15 },
  trend: {
    fill: 'none',
    stroke: 'var(--color-green)',
    strokeWidth: 'var(--border-width-lg)',
    strokeLinejoin: 'round',
    strokeLinecap: 'round'
  },
  point: {
    fill: 'var(--color-green)',
    stroke: 'var(--color-surface)',
    strokeWidth: 'var(--border-width-lg)'
  },
  baselineMarker: {
    fill: 'var(--color-surface)',
    stroke: 'var(--color-green)',
    strokeWidth: 'var(--border-width-lg)'
  },
  adjustmentMarker: {
    fill: 'var(--color-green)',
    stroke: 'var(--color-surface)',
    strokeWidth: 'var(--border-width-lg)'
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-regular)'
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-9)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)' },
  legendGlyph: { width: 'var(--space-9)', height: 'var(--space-9)', flexShrink: 0 },
  disclosureTrigger: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  tableWrap: { overflowX: 'auto', marginTop: 'var(--space-6)' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-12)',
    fontVariantNumeric: 'tabular-nums'
  },
  th: {
    textAlign: 'start',
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-4)',
    color: 'var(--color-muted)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  td: {
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-4)',
    borderTopWidth: 'var(--border-width-sm)',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-line)'
  },

  // History + per-player change rows
  list: {
    display: 'grid',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  row: {
    display: 'grid',
    gap: 'var(--space-6)',
    minWidth: 0,
    paddingBlockEnd: 'var(--space-8)',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-line)',
    ':focus-visible': focusRing
  },
  rowTop: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-8)', minWidth: 0 },
  rowMain: { display: 'grid', gap: 'var(--space-1)', flex: 1, minWidth: 0 },
  rowTitle: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-5)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)'
  },
  outcomeChip: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    minWidth: 'var(--space-20)',
    minHeight: 'calc(var(--space-20) - var(--space-1))',
    paddingInline: 'var(--space-4)',
    borderRadius: 'var(--radius-6)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)'
  },
  outcomeWin: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  outcomeDraw: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-amber)' },
  outcomeLoss: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  adjustmentChip: {
    paddingInline: 'var(--space-6)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-green)',
    textAlign: 'center',
    overflowWrap: 'anywhere'
  },
  delta: {
    flexShrink: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-muted)'
  },
  deltaGain: { color: 'var(--color-green)' },
  deltaLoss: { color: 'var(--color-red)' },
  textButton: {
    justifySelf: 'start',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingInline: 'var(--space-9)',
    borderWidth: 0,
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    cursor: 'pointer',
    ':focus-visible': focusRing,
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  recalculated: {
    justifySelf: 'start',
    paddingBlock: 'var(--space-1)',
    paddingInline: 'var(--space-5)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  footer: { display: 'grid', gap: 'var(--space-6)', justifyItems: 'start' },

  // Explanation dialog
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-bg)',
    opacity: 0.97,
    zIndex: 20
  },
  viewport: {
    position: 'fixed',
    inset: 0,
    zIndex: 21,
    display: 'grid',
    placeItems: 'center',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: 'var(--space-12)'
  },
  popup: {
    position: 'relative',
    display: 'grid',
    gap: 'var(--space-11)',
    width: 'min(100%, calc(var(--space-40) * 9))',
    maxHeight: 'calc(100dvh - var(--space-20) - var(--space-4))',
    overflowY: 'auto',
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    overscrollBehavior: 'contain',
    boxSizing: 'border-box'
  },
  dialogTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  teamSection: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
  teamLabel: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-green)',
    textTransform: 'uppercase'
  },
  teamLabelOpponent: { color: 'var(--color-muted)' },
  playerCard: {
    display: 'grid',
    gap: 'var(--space-6)',
    minWidth: 0,
    padding: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    ':focus-visible': focusRing
  },
  playerSelected: {
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'var(--color-green)'
  },
  playerName: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-5)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    ':focus-visible': focusRing
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    columnGap: 'var(--space-8)',
    rowGap: 'var(--space-3)',
    margin: 0,
    fontSize: 'var(--font-size-12)'
  },
  factRow: { display: 'contents' },
  factLabel: { color: 'var(--color-muted)', margin: 0 },
  factValue: {
    margin: 0,
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'end',
    fontVariantNumeric: 'tabular-nums'
  },
  note: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  dialogActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  dialogAction: { flex: '1 1 calc(var(--space-40) * 3)', minWidth: 0 },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  }
});
