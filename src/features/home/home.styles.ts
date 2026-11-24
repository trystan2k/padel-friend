import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';
const bell = 'calc(var(--space-40) + var(--space-8))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-1)'
};
const onGreenRing = {
  outline: 'var(--border-width-lg) solid var(--color-on-green)',
  outlineOffset: 'var(--space-2)'
};

export const homeStyles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-18)',
    width: '100%',
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    paddingBlock: 'var(--space-18)',
    paddingInline: 'var(--space-20)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)'
  },
  bellSlot: { display: 'flex', flexShrink: 0, marginInlineStart: 'auto' },
  greeting: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  date: { margin: 0, fontSize: 'var(--font-size-15)', color: 'var(--color-muted)' },
  greetingTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'calc(var(--font-size-28) + var(--space-2))',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  levelCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  levelTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--space-12)'
  },
  levelMain: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  levelLabel: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)'
  },
  levelValue: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'calc(var(--font-size-34) + var(--font-size-18))',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  ballBar: {
    width: 'calc(var(--space-40) + var(--space-20) + var(--space-12))',
    height: 'var(--space-6)',
    borderRadius: 'var(--space-3)',
    backgroundColor: 'var(--color-lime)'
  },
  rank: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    flexShrink: 0
  },
  rankPosition: {
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  rankTotal: { fontSize: 'var(--font-size-14)', color: 'var(--color-muted)' },
  reliability: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  meter: {
    display: 'block',
    width: '100%',
    height: 'var(--space-8)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--space-4)',
    backgroundColor: 'var(--color-surface-2)',
    appearance: 'none',
    overflow: 'hidden',
    '::-webkit-meter-bar': {
      height: 'var(--space-8)',
      borderWidth: 0,
      borderStyle: 'none',
      borderRadius: 'var(--space-4)',
      backgroundColor: 'var(--color-surface-2)',
      backgroundImage: 'none'
    },
    '::-webkit-meter-optimum-value': {
      borderRadius: 'var(--space-4)',
      backgroundColor: 'var(--color-green)',
      backgroundImage: 'none'
    },
    '::-moz-meter-bar': {
      borderRadius: 'var(--space-4)',
      backgroundColor: 'var(--color-green)',
      backgroundImage: 'none'
    }
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: target,
    minWidth: target,
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-semibold)',
    ':focus-visible': focusRing
  },
  statsLink: { alignSelf: 'flex-start' },
  switcher: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 },
  switcherLabel: { fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: target,
    paddingInline: 'var(--space-13)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-14)',
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    boxSizing: 'border-box',
    maxWidth: '100%',
    minHeight: target,
    paddingBlock: 0,
    // Under 360px the header row is ~176px wide (chip reserve + bell), so the pill drops its
    // avatar and tightens padding to leave the community name room before it ellipsizes.
    paddingInlineStart: {
      default: 'var(--space-8)',
      '@media (max-width: 359px)': 'var(--space-10)'
    },
    paddingInlineEnd: {
      default: 'var(--space-14)',
      '@media (max-width: 359px)': 'var(--space-10)'
    },
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  pillAvatar: {
    display: { default: 'grid', '@media (max-width: 359px)': 'none' },
    placeItems: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-8))',
    height: 'calc(var(--space-20) + var(--space-8))',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  pillName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  pillCaret: { flexShrink: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-16)' },
  popup: {
    boxSizing: 'border-box',
    minWidth: 'var(--anchor-width)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)'
  },
  positioner: { zIndex: 10 },
  item: {
    display: 'flex',
    alignItems: 'center',
    minHeight: target,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-8)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': focusRing,
    ':hover': { backgroundColor: 'var(--color-surface-2)' },
    ':is([data-highlighted])': { backgroundColor: 'var(--color-surface-2)' },
    ':is([data-selected])': { fontWeight: 'var(--font-weight-semibold)' }
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    scrollMarginBlockStart: 'var(--space-12)'
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  nextCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    overflowWrap: 'anywhere'
  },
  nextTop: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  nextTime: { margin: 0, fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-lime)',
    color: 'var(--color-green-deep)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  nextVenue: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-22)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  nextMeta: { margin: 0, fontSize: 'var(--font-size-15)' },
  openButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    minHeight: bell,
    marginBlockStart: 'var(--space-6)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': onGreenRing
  },
  attention: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    overflow: 'hidden'
  },
  attentionItem: {
    ':not(:first-child)': {
      borderBlockStartWidth: 'var(--border-width-sm)',
      borderBlockStartStyle: 'solid',
      borderBlockStartColor: 'var(--color-hairline)'
    }
  },
  attentionLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-8))',
    paddingBlock: 'var(--space-12)',
    paddingInline: 'var(--space-16)',
    color: 'inherit',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'calc(-1 * var(--space-2))'
    }
  },
  glyph: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-12)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  glyphAmber: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  glyphGreen: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  rowText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    flex: 1,
    minWidth: 0
  },
  rowTitle: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  rowMeta: { margin: 0, fontSize: 'var(--font-size-14)', color: 'var(--color-muted)' },
  chevron: { flexShrink: 0, fontSize: 'var(--font-size-20)', color: 'var(--color-muted)' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-15)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  cardTitle: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  meta: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  body: { margin: 0, fontSize: 'var(--font-size-14)' },
  state: {
    margin: 0,
    padding: 'var(--space-13)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    fontSize: 'var(--font-size-14)',
    color: 'var(--color-text)'
  },
  notice: {
    margin: 0,
    padding: 'var(--space-13)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)'
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    minHeight: target,
    paddingInline: 'var(--space-16)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  rankRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    padding: 'var(--space-6) var(--space-9)',
    borderRadius: 'var(--radius-8)'
  },
  rankSelf: {
    backgroundColor: 'var(--color-green-soft)',
    fontWeight: 'var(--font-weight-semibold)'
  }
});
