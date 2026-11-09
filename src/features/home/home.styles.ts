import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-1)'
};

export const homeStyles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    width: '100%',
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-18)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  headerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  titles: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  subtitle: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  quickLinks: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', alignItems: 'center' },
  primaryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: target,
    paddingInline: 'var(--space-16)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-surface)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: target,
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-semibold)',
    ':focus-visible': focusRing
  },
  switcher: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
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
    gap: 'var(--space-8)',
    scrollMarginBlockStart: 'var(--space-12)'
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)',
    minHeight: target
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)'
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
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
  },
  navigation: {
    position: 'sticky',
    insetBlockEnd: 0,
    display: 'flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-1)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    zIndex: 5
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    flex: 1,
    minWidth: 0,
    minHeight: target,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    textDecoration: 'none',
    borderRadius: 'var(--radius-12)',
    ':focus-visible': focusRing
  },
  navActive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  navIcon: { width: 'var(--space-20)', height: 'var(--space-20)' }
});
