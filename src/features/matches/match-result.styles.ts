import * as stylex from '@stylexjs/stylex';

export const matchResultStyles = stylex.create({
  heroLabel: { color: 'var(--color-hero-copy)' },
  heroTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-22)',
    lineHeight: 'calc(var(--space-15) * 2)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-on-hero)'
  },
  overviewBadges: { gap: 'var(--space-5)' },
  overviewBadge: {
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase',
    lineHeight: 'var(--space-13)'
  },
  overviewTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    lineHeight: 'calc(var(--space-20) + var(--space-2))',
    fontWeight: 'var(--font-weight-bold)'
  },
  overviewTime: { lineHeight: 'var(--space-13)' },
  hero: {
    position: 'relative',
    minHeight: 'calc(var(--space-40) * 3 + var(--space-12) * 2)',
    overflow: 'hidden',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface-2)'
  },
  heroImage: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
  heroCopy: {
    position: 'relative',
    display: 'grid',
    gap: 'var(--space-6)',
    padding: 'var(--space-14)',
    color: 'var(--color-hero-copy)'
  },
  heroLink: {
    color: 'var(--color-hero-accent)',
    textDecoration: 'none',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'inline-flex',
    alignItems: 'start'
  },
  overview: { padding: 'var(--space-9)', gap: 'var(--space-5)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  effect: { justifySelf: 'start' },
  clockIcon: { color: 'var(--color-amber)' },
  page: {
    display: 'grid',
    gap: 'var(--space-10)',
    paddingBlockStart: 'var(--space-18)',
    paddingBlockEnd: 'var(--space-14)',
    paddingInline: 'var(--space-18)',
    width: '100%',
    marginInline: 'auto',
    minWidth: 0,
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-text)'
  },
  routeHeader: { display: 'grid', gap: 'var(--space-5)', position: 'relative' },
  routeTitle: {
    margin: 0,
    paddingInlineStart: 'calc(var(--space-20) + var(--space-4))',
    paddingInlineEnd: 'calc(var(--space-40) * 2 + var(--space-8) * 3)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-20)',
    lineHeight: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  routeBack: {
    position: 'absolute',
    top: 'calc(0px - var(--space-10))',
    left: 'calc(0px - var(--space-18))',
    display: 'grid',
    placeItems: 'center',
    width: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    color: 'var(--color-text)',
    backgroundColor: 'transparent',
    borderWidth: 0,
    textDecoration: 'none',
    fontSize: 'var(--font-size-24)'
  },
  card: {
    display: 'grid',
    gap: 'var(--space-9)',
    minWidth: 0,
    margin: 0,
    padding: 'var(--space-14)',
    borderWidth: 0,
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  form: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  teamCard: { gap: 'var(--space-9)' },
  teamGroup: { display: 'grid', gap: 'var(--space-9)' },
  chipRow: { minHeight: 'calc(var(--space-40) + var(--space-4))' },
  label: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)',
    textTransform: 'uppercase'
  },
  scoreRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-10)',
    minHeight: 'calc(var(--space-40) + var(--space-4))'
  },
  scoreControl: {
    width: 'calc(var(--space-40) + var(--space-18))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    flexShrink: 0
  },
  scoreValue: {
    width: 'calc(var(--space-40) + var(--space-18))',
    display: 'grid',
    placeItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-surface-2)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  navigation: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-1)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    flex: 1,
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    backgroundColor: 'transparent',
    borderWidth: 0,
    textDecoration: 'none',
    padding: 0,
    borderRadius: 'var(--radius-12)'
  },
  navActive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  navIcon: { width: 'var(--space-20)', height: 'var(--space-20)' },
  compactNumber: {
    width: '100%',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    borderWidth: 0,
    borderRadius: 'var(--radius-9)',
    textAlign: 'center',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    ':focus-visible': { outline: 'var(--border-width-lg) solid var(--color-green)' },
    ':is([aria-invalid="true"])': {
      outline: 'var(--border-width-sm) solid var(--color-red)',
      color: 'var(--color-red)'
    }
  },
  stateControl: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    ':disabled': { cursor: 'default' }
  },
  statePill: {
    margin: 0,
    display: 'inline-flex',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-20)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    maxWidth: '100%',
    overflowWrap: 'anywhere'
  },
  neutral: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  invalidState: { color: 'var(--color-red)' },
  summary: {
    listStyle: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingBlock: 0,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--space-17)',
    fontWeight: 'var(--font-weight-regular)'
  },
  recap: { display: 'grid', gap: 'var(--space-9)', margin: 0 },
  fact: { display: 'grid', gap: 'var(--space-3)' },
  factValue: { margin: 0, fontSize: 'var(--font-size-14)', lineHeight: 'var(--space-17)' },
  detailsCard: { gap: 'var(--space-12)' },
  inputField: { display: 'grid', gap: 'var(--space-6)', fontWeight: 'var(--font-weight-semibold)' },
  pendingRows: { display: 'grid', gap: 'var(--space-8)' },
  pendingProgress: {
    margin: 0,
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  pendingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-9)',
    paddingBlock: 'var(--space-8)',
    paddingInline: 'var(--space-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
  },
  statusIcon: {
    width: 'var(--space-17)',
    height: 'var(--space-17)',
    flexShrink: 0,
    color: 'var(--color-green)'
  },
  statusTitle: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  statusCopy: { display: 'grid', gap: 'var(--space-3)' },
  matrixName: {
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--space-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  reviewPlaceholder: {
    ':disabled': { backgroundColor: 'var(--color-green)', color: 'var(--color-bg)', opacity: 1 }
  },
  scoreMatrix: {
    width: 'calc(100% + var(--space-12))',
    marginBlock: 'calc(0px - var(--space-7))',
    marginInline: 'calc(0px - var(--space-6))',
    borderSpacing: 'var(--space-6) var(--space-7)',
    textAlign: 'center',
    fontSize: 'var(--font-size-12)'
  },
  matrixCell: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-7)',
    padding: 0,
    height: 'calc(var(--space-16) * 2)',
    width: 'var(--space-40)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--space-17)'
  },
  matrixTeam: { textAlign: 'start', height: 'calc(var(--space-17) * 2)' },
  matrixTeamLabel: {
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--space-17)'
  },
  matrixHead: {
    height: 'var(--space-20)',
    width: 'var(--space-40)',
    color: 'var(--color-muted)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  matrixTeamHead: {
    textAlign: 'start',
    height: 'var(--space-20)',
    color: 'var(--color-muted)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase'
  },
  proposed: {
    backgroundColor: 'var(--color-surface-2)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-16)',
    display: 'grid',
    gap: 'var(--space-7)'
  },
  title: {
    margin: 0,
    paddingInlineEnd: 'calc(var(--space-40) * 2 + var(--space-8) * 3)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--space-20)'
  },
  copy: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  steps: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 0,
    listStyle: 'none',
    margin: 0,
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-9)',
    justifySelf: 'start',
    maxWidth: '100%',
    whiteSpace: 'pre',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-15) + var(--space-14))',
    paddingBlock: 'var(--space-7)',
    paddingInline: 'var(--space-9)',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: 'var(--radius-18)',
    overflowWrap: 'anywhere'
  },
  field: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  input: {
    width: '100%',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingBlock: 0,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)',
    ':focus': { fontSize: 'var(--font-size-16)' },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  scores: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, calc(var(--space-40) * 4)), 1fr))',
    gap: 'var(--space-8)'
  },
  setRow: {
    display: 'grid',
    minWidth: 0,
    gap: 'var(--space-9)',
    padding: 0,
    margin: 0,
    borderWidth: 0
  },
  stepper: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    minWidth: 0,
    gap: 'var(--space-4)'
  },
  number: {
    width: '100%',
    minWidth: 0,
    textAlign: 'center',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    minHeight: 'calc(var(--space-40) + var(--space-4))'
  },
  button: {
    display: 'inline-flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    },
    ':disabled': { cursor: 'default', opacity: 0.6 }
  },
  primary: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    width: '100%',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase',
    ':disabled': {
      backgroundColor: 'var(--color-surface-2)',
      color: 'var(--color-muted)',
      opacity: 1
    }
  },
  positive: {
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    borderRadius: 'var(--radius-20)',
    margin: 0
  },
  error: {
    color: 'var(--color-red)',
    margin: 0,
    overflowWrap: 'anywhere',
    fontWeight: 'var(--font-weight-medium)'
  },
  pending: {
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)'
  }
});

export const matchResultReviewStyles = stylex.create({
  resultCard: {
    display: 'grid',
    gap: 'var(--space-9)',
    minWidth: 0,
    padding: 'var(--space-11)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  pendingDetailCard: {
    gap: 'var(--space-8)',
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent'
  },
  compactResultCard: {
    gap: 'var(--space-5)',
    padding: 'var(--space-8)'
  },
  compactFacts: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-5)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  compactLifecycle: {
    display: 'grid',
    gap: 'var(--space-3)',
    minWidth: 0
  },
  resultHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  groupHeading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-tight)',
    fontWeight: 'var(--font-weight-bold)'
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'var(--space-20)',
    paddingBlock: 'var(--space-3)',
    paddingInline: 'var(--space-8)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  statusPending: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  statusDisputed: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-red)' },
  statusConfirmed: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  statusAwaiting: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  resultMeta: {
    display: 'grid',
    gap: 'var(--space-3)',
    margin: 0,
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  countdown: { color: 'var(--color-amber)', fontWeight: 'var(--font-weight-semibold)' },
  deadlineReached: { color: 'var(--color-amber)', fontWeight: 'var(--font-weight-semibold)' },
  resolutionBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    padding: 'var(--space-11) var(--space-12)',
    borderRadius: 'var(--radius-13)',
    backgroundColor: 'var(--color-surface-2)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-amber)',
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  resolutionComplete: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  facts: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  scoresTable: {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    fontVariantNumeric: 'tabular-nums'
  },
  scoreHeading: {
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-4)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    overflowWrap: 'anywhere'
  },
  scoreCell: {
    paddingBlock: 'var(--space-5)',
    paddingInline: 'var(--space-4)',
    borderTopWidth: 'var(--border-width-sm)',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-line)',
    textAlign: 'center',
    overflowWrap: 'anywhere'
  },
  setRowHeading: { color: 'var(--color-muted)', fontWeight: 'var(--font-weight-semibold)' },
  approvalProgress: {
    margin: 0,
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  disputeCopy: { margin: 0, color: 'var(--color-red)', overflowWrap: 'anywhere' },
  impactCopy: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  actionRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', minWidth: 0 },
  action: { flex: '1 1 calc(var(--space-40) * 4)', minWidth: 0 },
  reviewApprove: { backgroundColor: 'var(--color-green)', color: 'var(--color-bg)' },
  rejectAction: { color: 'var(--color-red)' },
  correctionAction: {
    display: 'inline-flex',
    justifyContent: 'center',
    alignItems: 'center',
    flex: '1 1 calc(var(--space-40) * 4)',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  inlineFeedback: {
    margin: 0,
    padding: 'var(--space-8)',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  feedbackError: { color: 'var(--color-red)' },
  feedbackSuccess: { color: 'var(--color-green)' },
  reviewBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-bg)',
    opacity: 0.97,
    zIndex: 20
  },
  reviewViewport: {
    position: 'fixed',
    inset: 0,
    zIndex: 21,
    display: 'grid',
    placeItems: 'center',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: 'var(--space-12)'
  },
  reviewPopup: {
    position: 'relative',
    display: 'grid',
    gap: 'var(--space-11)',
    width: 'min(100%, calc(var(--space-40) * 9))',
    maxHeight: 'calc(100dvh - var(--space-20) - var(--space-4))',
    overflowY: 'auto',
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    overscrollBehavior: 'contain'
  },
  dialogHeader: { display: 'grid', gap: 'var(--space-3)' },
  dialogTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  dialogDescription: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  dialogForm: { display: 'grid', gap: 'var(--space-10)', minWidth: 0 },
  reasonFieldset: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 0,
    margin: 0,
    borderWidth: 0,
    minWidth: 0
  },
  reasonLegend: { padding: 0, fontWeight: 'var(--font-weight-semibold)' },
  reasonOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-9)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    overflowWrap: 'anywhere',
    cursor: 'pointer'
  },
  reasonRadio: {
    width: 'var(--space-18)',
    height: 'var(--space-18)',
    flexShrink: 0,
    accentColor: 'var(--color-green)'
  },
  reasonRequired: { color: 'var(--color-red)' },
  noteField: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  noteInput: {
    width: '100%',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) * 2)',
    padding: 'var(--space-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    resize: 'vertical',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    },
    ':is([aria-invalid="true"])': { borderColor: 'var(--color-red)' }
  },
  dialogHint: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  dialogNotice: {
    margin: 0,
    padding: 'var(--space-8) var(--space-9)',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    overflowWrap: 'anywhere'
  },
  dialogActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  dialogAction: { flex: '1 1 calc(var(--space-40) * 3)', minWidth: 0 },
  dialogSubmit: { backgroundColor: 'var(--color-red)', color: 'var(--color-bg)' },
  dialogError: { margin: 0, color: 'var(--color-red)', overflowWrap: 'anywhere' }
});
