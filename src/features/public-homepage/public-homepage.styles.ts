import * as stylex from '@stylexjs/stylex';

const rail = 'calc(var(--space-12) * 2)';
const majorGap = 'calc(var(--space-16) * 2)';
const tile = 'calc(var(--space-40) + var(--space-4))';
const pageRailLeft = 'max(calc(var(--space-12) * 2), env(safe-area-inset-left, 0px))';
const pageRailRight = 'max(calc(var(--space-12) * 2), env(safe-area-inset-right, 0px))';

export const styles = stylex.create({
  page: {
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minHeight: '100dvh',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto'
  },
  header: {
    paddingTop: 'calc(var(--space-16) + env(safe-area-inset-top, 0px))',
    paddingBottom: 'var(--space-16)',
    paddingLeft: pageRailLeft,
    paddingRight: pageRailRight,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-18) * 2 + env(safe-area-inset-top, 0px))'
  },
  brand: {
    maxWidth: 'calc(100% - var(--space-40) * 2 - var(--space-14) * 2)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: '1.2',
    overflowWrap: 'break-word'
  },
  logo: {
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    flexShrink: 0
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: majorGap,
    paddingTop: 'var(--space-20)',
    paddingBottom: majorGap,
    paddingLeft: pageRailLeft,
    paddingRight: pageRailRight
  },
  hero: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)' },
  title: {
    margin: 0,
    fontSize: 'calc(var(--font-size-15) * 2)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'break-word'
  },
  description: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-size-23)',
    overflowWrap: 'break-word'
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    paddingTop: 'var(--space-10)'
  },
  cta: { textDecoration: 'none', overflowWrap: 'break-word' },
  signedInNote: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-size-17)'
  },
  features: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)' },
  sectionTitle: {
    margin: 0,
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-size-22)'
  },
  featureList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)'
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'var(--space-14)',
    // Pencil strokes are not included in auto-layout padding.
    padding: 'calc(var(--space-16) - var(--border-width-sm))'
  },
  iconTile: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: tile,
    height: tile,
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)'
  },
  icon: { width: 'var(--font-size-22)', height: 'var(--font-size-22)' },
  cardCopy: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  cardTitle: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: '1.2',
    overflowWrap: 'break-word'
  },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-size-20)',
    overflowWrap: 'break-word'
  },
  footer: {
    display: 'grid',
    gap: 'var(--space-16)',
    backgroundColor: 'var(--color-surface)',
    borderTop: 'var(--border-width-sm) solid var(--color-hairline)',
    paddingTop: 'calc(' + rail + ' - var(--border-width-sm))',
    paddingBottom: 'max(calc(var(--space-16) * 2), env(safe-area-inset-bottom, 0px))',
    paddingLeft: pageRailLeft,
    paddingRight: pageRailRight
  },
  footerLinks: { display: 'grid', justifyItems: 'start', gap: 'var(--space-4)' },
  contact: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 'var(--space-8)',
    minWidth: 0
  },
  contactLabel: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  contactLink: { overflowWrap: 'anywhere', maxWidth: '100%' },
  operator: { display: 'grid', gap: 'var(--space-6)' }
});
