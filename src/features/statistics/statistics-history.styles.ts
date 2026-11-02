import * as stylex from '@stylexjs/stylex';

// Match history and confirmed-group detail. Tokens only; interactive targets keep the 44px floor
// and every outcome carries text, never colour alone.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const historyStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)'
  },
  subheading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)'
  },
  copy: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  strong: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' },
  list: { display: 'grid', gap: 'var(--space-8)', margin: 0, padding: 0, listStyle: 'none' },
  entry: {
    display: 'grid',
    gap: 'var(--space-5)',
    minWidth: 0,
    paddingBlockEnd: 'var(--space-8)',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-line)'
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
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)'
  },
  delta: {
    fontSize: 'var(--font-size-12)',
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
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  button: {
    justifySelf: 'start',
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
    cursor: 'pointer',
    ':focus-visible': focusRing,
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  page: {
    display: 'grid',
    gap: 'var(--space-8)',
    width: '100%',
    marginInline: 'auto',
    padding: 'var(--space-18)',
    color: 'var(--color-text)',
    minWidth: 0
  },
  pageHeader: { display: 'grid', gap: 'var(--space-4)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
    columnGap: 'var(--space-8)',
    rowGap: 'var(--space-3)',
    margin: 0,
    fontSize: 'var(--font-size-12)'
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
  setScore: { fontSize: 'var(--font-size-16)', fontWeight: 'var(--font-weight-bold)' },
  team: { display: 'grid', gap: 'var(--space-6)', minWidth: 0 },
  teamLabel: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-green)',
    textTransform: 'uppercase'
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
