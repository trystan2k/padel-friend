import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';

// Clubhouse match detail (frames JLqMT, eYIgj, nNzWb, fo8Zn, SYMLa, tYXlh): 20-unit gutter, 12-unit
// rhythm, radius-18 cards. The hero reads photo, chips, venue and schedule, metrics, reserve row; the
// registration action card follows it. The status banner, header and share styles are shared with the
// invitation, result and management surfaces that mount on this page.
export const matchDetailShellStyles = stylex.create({
  resultEntryTitle: { lineHeight: 'calc(var(--space-20) + var(--space-6))' },
  resultParticipation: { gap: 'var(--space-6)' },
  resultCountLine: { lineHeight: 'calc(var(--space-12) + var(--space-5))' },
  // The result-entry state keeps its PAF-8 gutter until the results units (U15/U16) adapt it.
  resultEntryPage: {
    paddingInlineStart: 'var(--space-18)',
    paddingInlineEnd: 'var(--space-18)'
  },
  page: {
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 16)',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    paddingBlockStart: 'max(var(--space-4), env(safe-area-inset-top))',
    paddingBlockEnd: 'var(--space-20)',
    gap: 'var(--space-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere'
  },
  // The global language/theme chips still float top-right, so the header reserves their width.
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minHeight: target,
    paddingInlineEnd: 'calc(var(--space-40) * 2 + var(--space-8) * 3)'
  },
  heading: { display: 'grid', flexGrow: 1, gap: 'var(--space-2)', minWidth: 0 },
  subtitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: target,
    height: target,
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-14)',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  icon: { width: 'var(--space-20)', height: 'var(--space-20)', flexShrink: 0 },
  headerShare: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minHeight: target,
    minWidth: target,
    paddingInline: 'var(--space-14)',
    borderWidth: 0,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  groups: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  card: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0
  },
  hero: { padding: 0, overflow: 'hidden', gap: 0 },
  heroBody: { display: 'grid', gap: 'var(--space-8)', padding: 'var(--space-16)', minWidth: 0 },
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
    fontSize: 'var(--font-size-22)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  schedule: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
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
  metrics: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-8)',
    margin: 0
  },
  metric: {
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'center',
    gap: 'var(--space-2)',
    minWidth: 0,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    textAlign: 'center'
  },
  metricValue: {
    margin: 0,
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  metricLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
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
    height: 'calc(var(--space-40) * 4)',
    aspectRatio: 'auto',
    objectFit: 'cover',
    borderRadius: 0,
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
