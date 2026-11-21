import * as stylex from '@stylexjs/stylex';

// Clubhouse level review request (qWosG) and status (OKYtp) frames: 48px back target and 17/700
// title, flat fields on the page, 20px hairline cards, a 14px muted meta tone and 52px/48px
// actions. The history, platform queue and platform detail pages (D1, no frame) keep the older
// level-review.styles. Tokens only; every target is at least 44px.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const levelReviewClubhouse = stylex.create({
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
  topBar: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 },
  // History, queue and detail top bars sit on the frames' 8px inset: the 48px target at x8.
  topBarFrame: { marginInline: 'calc(-1 * var(--space-12))' },
  backLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-8))',
    height: 'calc(var(--space-40) + var(--space-8))',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  backIcon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    overflowWrap: 'anywhere'
  },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)', minWidth: 0 },
  card: { minWidth: 0, overflowWrap: 'anywhere' },
  // Frame row: muted label on the left, bold value on the right.
  levelRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4) var(--space-10)'
  },
  meta: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere'
  },
  value: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  label: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  userText: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  },
  fieldset: {
    margin: 0,
    padding: 0,
    border: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)'
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  modes: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  mode: {
    boxSizing: 'border-box',
    display: 'flex',
    flex: '1 1 0',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minHeight: touchTarget,
    minWidth: 'calc(var(--space-40) * 3)',
    padding: 'var(--space-7) var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  modeSelected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  radio: {
    flexShrink: 0,
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    margin: 0,
    accentColor: 'var(--color-green)',
    ':focus-visible': focusRing
  },
  levelFields: { display: 'grid', gap: 'var(--space-10)', gridTemplateColumns: 'minmax(0, 1fr)' },
  textarea: {
    minHeight: 'calc(var(--space-40) * 3)',
    paddingBlock: 'var(--space-12)',
    resize: 'vertical',
    fontFamily: 'var(--font-family-body)'
  },
  disclosureTrigger: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    padding: 'var(--space-7) var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  disclosurePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    paddingBlockStart: 'var(--space-10)'
  },
  alert: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-8)',
    padding: 'var(--space-12) var(--space-14)',
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
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
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
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  actionLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
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
  // Status notice (OKYtp): tone-soft row with a glyph, the state and its one-line summary.
  statusNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    minWidth: 0,
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  toneAmber: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  toneGreen: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  toneRed: { backgroundColor: 'var(--color-red-soft)', color: 'var(--color-red)' },
  toneMuted: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  noticeGlyph: {
    flexShrink: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  noticeCopy: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  statusLabel: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  statusText: { margin: 0, fontSize: 'var(--font-size-14)', overflowWrap: 'anywhere' },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-12)',
    paddingBlockEnd: 'var(--space-16)'
  },
  mark: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-12) * 2)',
    height: 'calc(var(--space-12) * 2)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  markDone: {
    borderColor: 'var(--color-green)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)'
  },
  markCurrent: { borderColor: 'var(--color-amber)' },
  markCanceled: { borderColor: 'var(--color-muted)', color: 'var(--color-muted)' },
  stepCopy: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  stepTitle: {
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  stepTitleMuted: { color: 'var(--color-muted)' },
  // "If approved / If rejected" explanation cards: 40px glyph + 16/800 title + 14px muted body.
  outcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'var(--space-12)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  outcomeGlyph: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  outcomeGlyphApproved: {
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  outcomeCopy: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
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
  footer: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
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
  // History (A9f626), platform queue (SCPeI) and platform detail (Y7NRH) frames: 28/800 page title,
  // hairline request cards with a pill status chip, 44/52px initials avatars, label/value rows,
  // a 44px arrow link, a sticky 52px action bar and the decision sheet.
  heading: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  pageTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  navTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    gap: 'var(--space-4)',
    margin: 0,
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-36)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  // Header rows wrap (chip below the title) when 200% zoom leaves no room beside it.
  cardHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  cardHeading: {
    flex: '1 1 calc(var(--space-40) * 3)',
    minWidth: 0,
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    overflowWrap: 'anywhere'
  },
  divider: {
    height: 0,
    margin: 0,
    borderWidth: 0,
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  linkRow: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 'var(--space-6)',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  linkIcon: { flexShrink: 0, width: 'var(--space-16)', height: 'var(--space-16)' },
  action: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  avatar: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  avatarLarge: {
    width: 'calc(var(--space-40) + var(--space-12))',
    height: 'calc(var(--space-40) + var(--space-12))',
    fontSize: 'var(--font-size-22)'
  },
  player: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 calc(var(--space-40) * 2)',
    gap: 'var(--space-2)',
    minWidth: 0
  },
  playerName: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)',
    overflowWrap: 'anywhere'
  },
  playerNameLarge: { fontSize: 'var(--font-size-20)' },
  rowValue: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    paddingInline: 'var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    ':focus-visible': focusRing
  },
  auditItem: { display: 'flex', alignItems: 'center', gap: 'var(--space-10)', minWidth: 0 },
  auditTile: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-12) * 3)',
    height: 'calc(var(--space-12) * 3)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)'
  },
  stack: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  eventTitle: { margin: 0, fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  actionBar: {
    position: 'sticky',
    insetBlockEnd: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-8)',
    marginInline: 'calc(-1 * var(--space-20))',
    marginBlockEnd: 'calc(-1 * var(--space-20))',
    padding:
      'var(--space-12) var(--space-20) max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom))',
    backgroundColor: 'var(--color-surface)',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  barSecondary: { flex: '0 0 auto', width: 'calc(var(--space-40) * 2 + var(--space-14) * 2)' },
  // At 200% zoom the confirm action wraps below Deny / Cancel instead of shrinking under 44px.
  barPrimary: { flex: '1 1 calc(var(--space-40) * 3)', minWidth: 0 },
  sheet: {
    boxSizing: 'border-box',
    position: 'fixed',
    insetInline: 0,
    insetBlockEnd: 0,
    marginInline: 'auto',
    maxWidth: 'calc(var(--space-40) * 12)',
    maxHeight: '90dvh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    padding:
      'var(--space-20) var(--space-20) max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom))',
    borderStartStartRadius: 'var(--radius-20)',
    borderStartEndRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    zIndex: 21
  },
  sheetNote: {
    margin: 0,
    padding: 'var(--space-12)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    fontSize: 'var(--font-size-16)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  },
  sheetActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  }
});
