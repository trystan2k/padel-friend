import * as stylex from '@stylexjs/stylex';

// Player statistics. Tokens only; interactive targets keep the 44px floor and every state carries
// text, never colour alone. Grids are fluid so translated labels wrap instead of overflowing.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const playerStyles = stylex.create({
  page: {
    display: 'grid',
    gap: 'var(--space-12)',
    width: '100%',
    marginInline: 'auto',
    padding: 'var(--space-18)',
    color: 'var(--color-text)',
    minWidth: 0
  },
  header: { display: 'grid', gap: 'var(--space-4)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  // minmax(0, 1fr): a wide table inside the card scrolls instead of widening the grid track.
  section: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-8)',
    minWidth: 0
  },
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
    fontSize: 'var(--font-size-12)',
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
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  valueMuted: { color: 'var(--color-muted)' },
  detail: {
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  outcomes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  chart: { width: '100%', height: 'auto', maxHeight: '160px' },
  bar: { fill: 'var(--color-green)' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-12)',
    fontVariantNumeric: 'tabular-nums'
  },
  tableScroll: { overflowX: 'auto', maxWidth: '100%' },
  caption: {
    textAlign: 'start',
    paddingBlockEnd: 'var(--space-3)',
    color: 'var(--color-muted)'
  },
  cell: {
    paddingBlock: 'var(--space-3)',
    paddingInline: 'var(--space-4)',
    textAlign: 'start',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-line)'
  },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' },
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
    ':focus-visible': focusRing
  }
});
