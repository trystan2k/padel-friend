import * as stylex from '@stylexjs/stylex';

// Me page (Clubhouse frame vARtQ): flat identity header on the page background, a level card,
// a hairline list of destination rows, then the existing settings/edit surfaces. Tokens only;
// tap targets are 48px rows / 52px actions.
const TAP = 'calc(var(--space-40) + var(--space-8))';
const ROW = 'calc(var(--space-40) + var(--space-20))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const me = stylex.create({
  page: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    marginInline: 'auto',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    // Clears the fixed language/theme chips that sit top-right on every protected page.
    paddingBlockStart:
      'max(calc(var(--space-40) + var(--space-20) + var(--space-16)), env(safe-area-inset-top))',
    paddingBlockEnd: 'var(--space-20)',
    display: 'grid',
    gap: 'var(--space-14)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowWrap: 'anywhere'
  },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  identity: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-14)',
    minWidth: 0
  },
  // vARtQ: one card with three equal stat columns (matches, W–L–D, win rate) between identity and the level card.
  stats: {
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    margin: 0,
    paddingBlock: 'var(--space-12)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  statTile: {
    boxSizing: 'border-box',
    display: 'flex',
    // The definition term precedes its value in the DOM; the frame shows the value on top.
    flexDirection: 'column-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    minWidth: 0,
    paddingInline: 'var(--space-4)',
    textAlign: 'center'
  },
  statValue: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1.2,
    overflowWrap: 'anywhere'
  },
  statLabel: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  statsUnavailable: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  identityText: { display: 'grid', gap: 'var(--space-2)', minWidth: 0, flex: 1 },
  name: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-25)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1.2
  },
  meta: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  avatar: {
    width: 'calc(var(--space-40) + var(--space-20) + var(--space-12))',
    height: 'calc(var(--space-40) + var(--space-20) + var(--space-12))',
    borderRadius: 'var(--radius-36)',
    objectFit: 'cover',
    backgroundColor: 'var(--color-lime)',
    color: 'var(--palette-text)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  editButton: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  editButtonOn: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  editIcon: { width: 'var(--space-16)', height: 'var(--space-16)' },
  levelTop: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-8)'
  },
  levelHeader: { display: 'grid', gap: 'var(--space-2)' },
  levelLabel: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  levelMetric: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-34)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1.1,
    color: 'var(--color-text)'
  },
  reliability: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)'
  },
  progressTrack: {
    width: '100%',
    height: 'var(--space-14)',
    borderRadius: 'var(--radius-7)',
    backgroundColor: 'var(--color-surface-2)',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--color-green)',
    borderRadius: 'var(--radius-7)'
  },
  scaleCaption: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  scaleEndpoint: { fontWeight: 'var(--font-weight-medium)' },
  fact: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-8)',
    fontSize: 'var(--font-size-15)'
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    overflow: 'hidden'
  },
  listItem: {
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)',
    ':first-child': { borderBlockStartWidth: 0 }
  },
  row: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    minHeight: ROW,
    paddingBlock: 'var(--space-8)',
    paddingInline: 'var(--space-16)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    ':focus-visible': { ...focusRing, outlineOffset: 'calc(-1 * var(--space-4))' }
  },
  rowIcon: {
    width: 'calc(var(--space-20) + var(--space-2))',
    height: 'calc(var(--space-20) + var(--space-2))',
    flexShrink: 0,
    color: 'var(--color-muted)'
  },
  rowText: { display: 'grid', gap: 'var(--space-2)', minWidth: 0, flex: 1 },
  rowTitle: { fontSize: 'var(--font-size-16)', fontWeight: 'var(--font-weight-bold)' },
  rowMeta: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)'
  },
  chevron: { color: 'var(--color-muted)', fontSize: 'var(--font-size-20)', flexShrink: 0 },
  primaryRow: { color: 'var(--color-green-ink)' },
  stack: { display: 'grid', gap: 'var(--space-12)' },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  actionButton: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: TAP,
    paddingInline: 'var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-14)' }
});
