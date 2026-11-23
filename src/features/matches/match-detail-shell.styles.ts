import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';

// Clubhouse match detail (frames JLqMT, eYIgj, nNzWb, fo8Zn, SYMLa, tYXlh): shared top bar, 20-unit
// gutter, 14-unit rhythm. The hero reads photo, chips, venue title, date line and a compact
// playing/level/price strip; roster and registration status follow it, lower-priority management
// panels come next, and the registration action sticks to the bottom. The status banner and card styles
// are shared with the invitation, result and management surfaces that mount on this page.
export const matchDetailShellStyles = stylex.create({
  resultEntryTitle: { lineHeight: 'calc(var(--space-20) + var(--space-6))' },
  resultParticipation: { gap: 'var(--space-6)' },
  resultCountLine: { lineHeight: 'calc(var(--space-12) + var(--space-5))' },
  // The result-entry state keeps its PAF-8 gutter until the results units (U15/U16) adapt it.
  resultEntryPage: {
    paddingInlineStart: 'var(--space-18)',
    paddingInlineEnd: 'var(--space-18)'
  },
  // The top bar owns the chrome (data-route-chrome="navigation"), so the page carries no chip inset.
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    minHeight: '100dvh',
    marginInline: 'auto',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere'
  },
  // Frame content column: 4/20/20/20 inset, 14 rhythm. It is the sticky action bar's containing block.
  icon: { width: 'var(--space-20)', height: 'var(--space-20)', flexShrink: 0 },
  groups: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    gap: 'var(--space-14)',
    minWidth: 0,
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    paddingBlockStart: 'var(--space-4)',
    paddingBlockEnd: 'var(--space-20)'
  },
  // Frame "Sticky actions": white bar, 12/20/24 inset, hairline top edge, bleeding past the content gutter.
  actionBar: {
    position: 'sticky',
    insetBlockEnd: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    marginBlockStart: 'auto',
    marginBlockEnd: 'calc(var(--space-20) * -1)',
    marginInlineStart: 'calc(max(var(--space-20), env(safe-area-inset-left)) * -1)',
    marginInlineEnd: 'calc(max(var(--space-20), env(safe-area-inset-right)) * -1)',
    paddingBlockStart: 'var(--space-12)',
    paddingBlockEnd: 'max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom))',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    backgroundColor: 'var(--color-surface)',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  barNotice: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  barAction: { display: 'grid', gap: 'var(--space-8)', justifyItems: 'stretch' },
  shareStatus: { margin: 0, paddingInline: 'max(var(--space-20), env(safe-area-inset-left))' },
  card: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0
  },
  // Frame hero: photo, chips and title sit on the page background, not inside a card.
  hero: { display: 'grid', gap: 'var(--space-14)', minWidth: 0 },
  heroBody: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-6)',
    margin: 0
  },
  title: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  venue: {
    fontFamily: 'var(--font-family-heading)',
    fontWeight: 'var(--font-weight-extrabold)',
    fontSize: 'var(--font-size-28)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  schedule: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  copy: { margin: 0, color: 'var(--color-muted)' },
  note: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-13)' },
  participants: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  accepted: {
    margin: 0,
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  // Frame "Stats": one white strip, three equal centered columns (playing, level, price).
  metrics: {
    boxSizing: 'border-box',
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
    paddingBlock: 'var(--space-12)',
    margin: 0,
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  metric: {
    display: 'grid',
    alignContent: 'center',
    justifyItems: 'center',
    gap: 'var(--space-2)',
    minWidth: 0,
    paddingInline: 'var(--space-4)',
    textAlign: 'center'
  },
  metricValue: {
    margin: 0,
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  metricLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)'
  },
  reserveRow: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)',
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)'
  },
  reserveText: { display: 'grid', minWidth: 0 },
  reserveTitle: { fontSize: 'var(--font-size-14)', fontWeight: 'var(--font-weight-bold)' },
  reserveNote: { color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  reserveCount: { fontSize: 'var(--font-size-16)', fontWeight: 'var(--font-weight-extrabold)' },
  image: {
    display: 'block',
    width: '100%',
    height: 'calc(var(--space-40) * 3 + var(--space-12))',
    aspectRatio: 'auto',
    objectFit: 'cover',
    borderRadius: 'var(--radius-20)',
    minHeight: 0
  },
  cancelledBadge: {
    display: 'flex',
    justifyContent: 'flex-start',
    minHeight: 'calc(var(--space-20) + var(--space-4))'
  },
  maps: {
    display: 'inline-flex',
    alignItems: 'center',
    justifySelf: 'start',
    minHeight: target,
    minWidth: target,
    paddingInline: 0,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  shareField: { display: 'grid', gap: 'var(--space-4)', color: 'var(--color-muted)' },
  input: {
    width: '100%',
    minWidth: 0,
    resize: 'none',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    paddingInline: 'var(--space-12)',
    fontSize: 'var(--font-size-14)'
  },
  banner: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)'
  },
  positive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  positiveAccent: { color: 'var(--color-green-ink)' },
  bannerHeading: { display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }
});
