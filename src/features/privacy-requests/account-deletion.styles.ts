import * as stylex from '@stylexjs/stylex';

// Account deletion pane: the level-review status frame conventions (page column, 14px hairline
// cards, tone-soft status notice, 52px actions, 20px popup) with tokens only; every target is at
// least 44px and every text block wraps for long translations.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const deletion = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    minHeight: '100vh',
    marginInline: 'auto',
    padding: 'var(--space-4) var(--space-20) var(--space-20)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  barFrame: { marginInline: 'calc(-1 * var(--space-20))' },
  card: { minWidth: 0, overflowWrap: 'anywhere' },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    overflowWrap: 'anywhere'
  },
  meta: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere'
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
    columnGap: 'var(--space-12)',
    rowGap: 'var(--space-6)',
    margin: 0,
    fontSize: 'var(--font-size-14)'
  },
  factLabel: { margin: 0, color: 'var(--color-muted)' },
  factValue: { margin: 0, fontWeight: 'var(--font-weight-semibold)', overflowWrap: 'anywhere' },
  statusNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  toneAmber: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  toneGreen: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  toneRed: { backgroundColor: 'var(--color-red-soft)', color: 'var(--color-red)' },
  toneMuted: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  noticeCopy: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  statusLabel: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  statusText: { margin: 0, fontSize: 'var(--font-size-14)', overflowWrap: 'anywhere' },
  notice: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  srOnly: {
    position: 'absolute',
    width: 'var(--border-width-sm)',
    height: 'var(--border-width-sm)',
    margin: 'calc(-1 * var(--border-width-sm))',
    padding: 0,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0
  },
  alertText: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  textButton: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    paddingInline: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  mailLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere',
    textDecoration: 'underline',
    ':focus-visible': focusRing
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-bg)',
    opacity: 0.94,
    zIndex: 20
  },
  popup: {
    boxSizing: 'border-box',
    position: 'fixed',
    insetInline: 'var(--space-16)',
    top: 'var(--space-40)',
    marginInline: 'auto',
    maxWidth: 'calc(var(--space-40) * 10)',
    maxHeight: 'calc(100dvh - var(--space-40) - var(--space-40))',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    zIndex: 21
  },
  popupTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  popupBody: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-16)' },
  disclosure: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)', margin: 0 },
  disclosureItem: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  disclosureTitle: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  disclosureList: {
    margin: 0,
    paddingInlineStart: 'var(--space-18)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)'
  },
  disclosureBody: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    overflowWrap: 'anywhere'
  }
});
