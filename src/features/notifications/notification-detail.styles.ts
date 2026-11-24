import * as stylex from '@stylexjs/stylex';

// Clubhouse notification detail frames (dkFFb generic, k2CxJR match result, d0Qcrm / U3UJJj level
// review; each with a dark twin): 56px top bar with a 48px back target and a centered 17/700 title,
// a 44px type tile with the muted received time and a read chip, a 28/800 title, a 16px body, a
// hairline outcome card (18/800 title, chip, 14px rows) and a 52px outlined action. The community
// invitation branch keeps its own invitation styles. Tokens only; every target is at least 44px.
const backSize = 'calc(var(--space-40) + var(--space-8))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const detailStyles = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    minHeight: '100dvh',
    marginInline: 'auto',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  topBar: {
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: `${backSize} minmax(0, 1fr) ${backSize}`,
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingInline: 'var(--space-8)',
    paddingBlockStart: 'env(safe-area-inset-top)'
  },
  backLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: backSize,
    height: backSize,
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  backIcon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  navTitle: {
    margin: 0,
    textAlign: 'center',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  content: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    minWidth: 0,
    padding: 'var(--space-4) var(--space-20) max(var(--space-20), env(safe-area-inset-bottom))'
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-12)',
    minWidth: 0
  },
  tile: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  received: {
    flex: '1 1 calc(var(--space-40) * 2)',
    minWidth: 0,
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: 'var(--space-4)',
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-36)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  chipGreen: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  chipRed: { backgroundColor: 'var(--color-red-soft)', color: 'var(--color-red)' },
  chipMuted: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  body: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)',
    overflowWrap: 'anywhere'
  },
  card: { minWidth: 0, gap: 'var(--space-10)', overflowWrap: 'anywhere' },
  cardHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  cardTitle: {
    flex: '1 1 calc(var(--space-40) * 3)',
    minWidth: 0,
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  divider: {
    height: 0,
    margin: 0,
    borderWidth: 0,
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4) var(--space-12)',
    margin: 0
  },
  label: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  value: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  note: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere'
  },
  alert: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  action: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    padding: 'var(--space-12)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  actionIcon: { flexShrink: 0, width: 'var(--space-16)', height: 'var(--space-16)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  }
});
