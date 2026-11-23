import * as stylex from '@stylexjs/stylex';

// Match history and confirmed-group detail. Tokens only; interactive targets keep the 44px floor
// and every outcome carries text, never colour alone.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const CONTROL = 'calc(var(--space-40) + var(--space-8))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const historyStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
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
  strong: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-14)' },
  list: { display: 'grid', gap: 'var(--space-8)', margin: 0, padding: 0, listStyle: 'none' },
  // History rows are hairline cards, one per match (frame list rows: 20px radius, 16px padding).
  entry: {
    display: 'grid',
    gap: 'var(--space-6)',
    minWidth: 0,
    padding: 'var(--space-14) var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  badges: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-4)' },
  scoreLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 'var(--space-6)',
    fontVariantNumeric: 'tabular-nums'
  },
  outcome: {
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)'
  },
  delta: {
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)',
    fontVariantNumeric: 'tabular-nums'
  },
  deltaGain: { color: 'var(--color-green)' },
  deltaLoss: { color: 'var(--color-red)' },
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
  inlineLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'underline',
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
    ':focus-visible': focusRing,
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  // Clubhouse page (BcpYH): page background, 20px gutters, 14px rhythm.
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
  // The shared top bar bleeds out of the page gutter (group detail).
  barFrame: { marginInline: 'calc(-1 * var(--space-20))' },
  pageHeader: { display: 'grid', gap: 'var(--space-8)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
    columnGap: 'var(--space-8)',
    rowGap: 'var(--space-6)',
    margin: 0,
    fontSize: 'var(--font-size-14)'
  },
  factLabel: { margin: 0, color: 'var(--color-muted)' },
  factValue: { margin: 0, fontWeight: 'var(--font-weight-semibold)', overflowWrap: 'anywhere' },
  setRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-6)',
    fontVariantNumeric: 'tabular-nums'
  },
  setScore: { fontSize: 'var(--font-size-17)', fontWeight: 'var(--font-weight-extrabold)' },
  team: { display: 'grid', gap: 'var(--space-6)', minWidth: 0 },
  // BcpYH: one score row per team, followed by a separate verdict notice.
  hero: { gap: 'var(--space-8)', minWidth: 0 },
  heroLabel: {
    margin: 0,
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)'
  },
  scoreTable: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  hidden: {
    position: 'absolute',
    width: 'var(--border-width-sm)',
    height: 'var(--border-width-sm)',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  heroNames: {
    width: '100%',
    textAlign: 'start',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  heroScore: {
    paddingBlock: 'var(--space-4)',
    paddingInlineStart: 'var(--space-8)',
    textAlign: 'end',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-21)',
    fontWeight: 'var(--font-weight-extrabold)',
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums'
  },
  heroLine: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 'var(--space-8)',
    rowGap: 'var(--space-2)',
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green-soft)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-green-ink)',
    overflowWrap: 'anywhere'
  },
  teamScore: {
    marginInlineStart: 'var(--space-6)',
    color: 'var(--color-muted)',
    fontWeight: 'var(--font-weight-semibold)',
    textTransform: 'none'
  },
  teamLabel: {
    margin: 0,
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-green)'
  },
  player: {
    display: 'grid',
    gap: 'var(--space-3)',
    minWidth: 0,
    padding: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  playerName: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-5)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  timeline: {
    display: 'grid',
    gap: 'var(--space-5)',
    margin: 0,
    paddingInlineStart: 'var(--space-12)'
  }
});
