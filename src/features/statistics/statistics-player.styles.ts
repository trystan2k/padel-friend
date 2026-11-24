import * as stylex from '@stylexjs/stylex';

// Player statistics. Tokens only; interactive targets keep the 44px floor and every state carries
// text, never colour alone. Grids are fluid so translated labels wrap instead of overflowing.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const CONTROL = 'calc(var(--space-40) + var(--space-8))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const playerStyles = stylex.create({
  // Clubhouse page (RN0yw): page background, 20px gutters, 14px rhythm between sections.
  page: {
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'start',
    gap: 'var(--space-14)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    minHeight: '100vh',
    marginInline: 'auto',
    padding: 'var(--space-4) var(--space-20) var(--space-20)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minWidth: 0
  },
  // The shared top bar bleeds out of the page gutter (RN0yw).
  barFrame: { marginInline: 'calc(-1 * var(--space-20))' },
  header: { display: 'grid', gap: 'var(--space-4)' },
  // Highlight tiles: three fluid columns where they fit, wrapping at 320px instead of shrinking text.
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 96px), 1fr))',
    gap: 'var(--space-8)',
    margin: 0
  },
  tile: {
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  tileValue: {
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  // Pair / head-to-head identity (GrkSH, khmeK): two initials avatars with a connector, then the
  // other player's name; wraps instead of clipping when a translated name or caption is long.
  identity: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 'var(--space-12)',
    rowGap: 'var(--space-8)',
    minWidth: 0
  },
  avatars: { display: 'flex', alignItems: 'center', gap: 'var(--space-10)', flexShrink: 0 },
  avatar: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) + var(--space-16))',
    height: 'calc(var(--space-40) + var(--space-16))',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  avatarFocal: { backgroundColor: 'var(--color-lime)', color: 'var(--color-green-deep)' },
  connector: {
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-muted)'
  },
  identityText: {
    display: 'grid',
    gap: 'var(--space-2)',
    flex: '1 1 calc(var(--space-40) * 3)',
    minWidth: 0
  },
  identityName: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  // Headline metric tile: figure above its label; the label stays the term for assistive tech.
  tileStack: { display: 'flex', flexDirection: 'column-reverse', gap: 'var(--space-2)' },
  tileBody: {
    margin: 0,
    display: 'grid',
    gap: 'var(--space-2)',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0
  },
  strip: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    margin: 0,
    padding: 'var(--space-14) var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    fontSize: 'var(--font-size-15)',
    fontVariantNumeric: 'tabular-nums'
  },
  stripLabel: { color: 'var(--color-muted)' },
  stripValue: {
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)'
  },
  // Compact figure rows (partnership summary): label and value stay on one line while they fit.
  compact: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 'var(--space-12)',
    rowGap: 'var(--space-6)',
    margin: 0
  },
  // Recent-match rows (RN0yw): one stacked card per match; meta row first, link last.
  recentList: {
    display: 'grid',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  recentRow: {
    display: 'grid',
    gap: 'var(--space-6)',
    padding: 'var(--space-14) var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0
  },
  recentMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 'var(--space-8)',
    rowGap: 'var(--space-4)',
    fontSize: 'var(--font-size-14)',
    color: 'var(--color-muted)'
  },
  headline: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere'
  },
  filterAccess: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'underline',
    ':focus-visible': focusRing
  },
  // minmax(0, 1fr): a wide table inside the card scrolls instead of widening the grid track.
  section: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-10)',
    minWidth: 0
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)'
  },
  subheading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)'
  },
  copy: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 'var(--space-8)',
    margin: 0
  },
  stat: {
    display: 'grid',
    alignContent: 'start',
    gap: 'var(--space-2)',
    minWidth: 0
  },
  statLabel: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  statValue: {
    margin: 0,
    display: 'grid',
    gap: 'var(--space-2)',
    fontVariantNumeric: 'tabular-nums'
  },
  value: {
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  valueMuted: { color: 'var(--color-muted)' },
  detail: {
    fontSize: 'var(--font-size-13)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  chart: { width: '100%', height: 'auto', maxHeight: '160px' },
  bar: { fill: 'var(--color-green)' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-14)',
    fontVariantNumeric: 'tabular-nums'
  },
  tableScroll: { overflowX: 'auto', maxWidth: '100%' },
  caption: {
    textAlign: 'start',
    paddingBlockEnd: 'var(--space-3)',
    color: 'var(--color-muted)'
  },
  cell: {
    paddingBlock: 'var(--space-8)',
    paddingInline: 'var(--space-6)',
    textAlign: 'start',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-hairline)'
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-14)' },
  link: {
    justifySelf: 'start',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: CONTROL,
    minWidth: TOUCH,
    paddingInline: 'var(--space-16)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  button: {
    justifySelf: 'start',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CONTROL,
    minWidth: TOUCH,
    paddingInline: 'var(--space-16)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  // Tile and row definitions stay in the markup for assistive tech without a paragraph under every figure.
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderStyle: 'none'
  },
  // Row card (o9iaC1): hairline 20px card of label-left / value-right rows.
  rowCard: {
    display: 'grid',
    margin: 0,
    padding: 'var(--space-4) var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  rowStat: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 'var(--space-12)',
    rowGap: 'var(--space-2)',
    minHeight: CONTROL,
    paddingBlock: 'var(--space-8)'
  },
  rowValue: { textAlign: 'end', marginInlineStart: 'auto' },
  // Recent form (RN0yw): chronological W/L/D squares, oldest first; letter plus hidden full word.
  formLead: {
    display: 'grid',
    gap: 'var(--space-8)',
    minWidth: 0,
    marginBlockEnd: 'var(--space-14)'
  },
  formSquares: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-6)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  square: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) - var(--space-4))',
    height: 'calc(var(--space-40) - var(--space-4))',
    borderRadius: 'var(--radius-12)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  squareWin: { backgroundColor: 'var(--color-green)', color: 'var(--color-on-green)' },
  squareLoss: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  squareDraw: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  // Meeting rows (GrkSH / khmeK): one row per match inside the card instead of a scrolling table.
  meetingList: {
    display: 'grid',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  meetingRow: {
    display: 'grid',
    gap: 'var(--space-6)',
    paddingBlock: 'var(--space-8)',
    minWidth: 0
  },
  meetingHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 'var(--space-10)',
    rowGap: 'var(--space-4)'
  },
  meetingLead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 'var(--space-10)',
    rowGap: 'var(--space-4)',
    minWidth: 0
  },
  meetingDate: {
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)'
  },
  meetingScore: {
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums'
  }
});
