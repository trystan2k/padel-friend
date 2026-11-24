import * as stylex from '@stylexjs/stylex';

// Frames Fj5bc / ssomJ (league index): 56px top bar with the 48px back target and a centered 17/700
// title, 28/800 heading, 52px Create league action, 18/800 section titles and 20px hairline cards
// (18/800 name, status chip, chevron, 14px dates). Tokens only; every target is at least 44px.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const leagueIndex = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: '0 var(--space-20) var(--space-20)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  // Back target (48px), centered title, and the frame's 72px top-action slot so the title stays
  // centered. The bar sits on the frames' 8px inset and hands 10px back to the 14px page rhythm.
  topBar: {
    display: 'grid',
    gridTemplateColumns:
      'calc(var(--space-40) + var(--space-8)) minmax(0, 1fr) calc(var(--space-40) + var(--space-20) + var(--space-12))',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    marginInline: 'calc(-1 * var(--space-12))',
    marginBlockEnd: 'calc(-1 * var(--space-10))'
  },
  navTitle: {
    margin: 0,
    textAlign: 'center',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  heading: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  context: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)',
    overflowWrap: 'anywhere'
  },
  create: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  createIcon: { width: 'var(--space-16)', height: 'var(--space-16)', flexShrink: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  card: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    minHeight: touchTarget,
    padding: 'var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minWidth: 0 },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  chip: { borderRadius: 'var(--radius-36)', flexShrink: 0 },
  chipDot: {
    width: 'var(--space-8)',
    height: 'var(--space-8)',
    marginInlineEnd: 'var(--space-6)',
    borderRadius: '50%',
    backgroundColor: 'currentColor'
  },
  chevron: {
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    flexShrink: 0,
    color: 'var(--color-muted)'
  },
  period: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  blocked: {
    margin: 0,
    color: 'var(--color-amber)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  }
});
