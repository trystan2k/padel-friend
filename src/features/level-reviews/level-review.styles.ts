import * as stylex from '@stylexjs/stylex';

// Shared level review styles for the pages without an approved Clubhouse frame (D1): player
// history, platform queue and platform detail, plus the result-repair surfaces that borrow them.
// The request and status pages use level-review-clubhouse.styles. Tokens only; targets are at
// least 44px.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const levelReview = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    minHeight: '100vh',
    marginInline: 'auto',
    padding: 'var(--space-18) var(--space-18) var(--space-14)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', minWidth: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minWidth: 0 },
  backLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: touchTarget,
    minHeight: touchTarget,
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  context: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    overflowWrap: 'anywhere'
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  muted: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  text: { margin: 0, fontSize: 'var(--font-size-12)', overflowWrap: 'anywhere' },
  strong: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  // Free text is shown as typed: line breaks kept, links inert, never interpreted as markup.
  userText: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  },
  fieldset: {
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)'
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  modes: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)' },
  mode: {
    boxSizing: 'border-box',
    display: 'flex',
    flex: '1 1 0',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minHeight: touchTarget,
    minWidth: 'calc(var(--space-40) * 3)',
    padding: 'var(--space-7) var(--space-10)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  modeSelected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  radio: {
    flexShrink: 0,
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    margin: 0,
    accentColor: 'var(--color-green)',
    ':focus-visible': focusRing
  },
  textarea: {
    minHeight: 'calc(var(--space-40) * 3)',
    paddingBlock: 'var(--space-10)',
    resize: 'vertical',
    fontFamily: 'var(--font-family-body)'
  },
  guidance: {
    margin: 0,
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-medium)'
  },
  alert: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-6)',
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-red)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0
  },
  alertText: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  notice: {
    margin: 0,
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-medium)',
    overflowWrap: 'anywhere'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  actionLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'underline',
    ':focus-visible': focusRing
  },
  textButton: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    paddingInline: 'var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing,
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  primaryLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget,
    paddingInline: 'var(--space-14)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  itemLink: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    minHeight: touchTarget,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  // Status panel (frame OKYtp): bold uppercase status over a one-line detail.
  statusLabel: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase',
    overflowWrap: 'anywhere'
  },
  toneAmber: { color: 'var(--color-amber)' },
  toneGreen: { color: 'var(--color-green)' },
  toneRed: { color: 'var(--color-red)' },
  toneMuted: { color: 'var(--color-muted)' },
  pendingBadge: {
    alignSelf: 'flex-start',
    padding: 'var(--space-4) var(--space-8)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  filterSelect: {
    boxSizing: 'border-box',
    minHeight: touchTarget,
    width: '100%',
    paddingInline: 'var(--space-10)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    ':focus-visible': focusRing
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    alignItems: 'flex-start'
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
    gap: 'var(--space-10)',
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    zIndex: 21
  },
  popupTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  }
});
