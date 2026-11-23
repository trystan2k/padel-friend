import * as stylex from '@stylexjs/stylex';

// Clubhouse community administration (frames wFqGR members, jQDkx member actions, RgqPq requests,
// N18Mu4 settings, A5Vio venues, E5CS5K audit). Every screen: 20px side padding, 56px bar with a
// 48px back target, 12px section gap, 52px controls, hairline list surfaces.
const tap = 'calc(var(--space-40) + var(--space-8))';
const control = 'calc(var(--space-40) + var(--space-12))';
const focus = {
  outline: 'var(--focus-width) solid var(--color-focus)',
  outlineOffset: 'var(--focus-offset)'
};
const sheetRadius =
  'calc(var(--space-20) + var(--space-8)) calc(var(--space-20) + var(--space-8)) 0 0';
const navClearance = 'calc(var(--space-20) + var(--space-40) + var(--space-16) + var(--space-40))';

export const styles = stylex.create({
  page: {
    boxSizing: 'border-box',
    height: '100vh',
    minHeight: '100vh',
    maxWidth: 'calc(var(--space-40) * 16)',
    marginInline: 'auto',
    paddingBlockStart: 'max(var(--space-4), env(safe-area-inset-top))',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    paddingBlockEnd: `calc(${navClearance} + env(safe-area-inset-bottom))`,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowY: 'auto',
    // The 100vh scrollport starts below the wrapping locale/theme controls. Clear their offset as
    // well as the fixed navigation when native Tab focus scrolls.
    scrollPaddingBottom: `calc(${navClearance} + var(--space-40))`
  },
  header: { display: 'flex', flexDirection: 'column', gap: 0 },
  screenHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-16))'
  },
  titleGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  subtitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    overflowWrap: 'anywhere'
  },
  backLink: {
    boxSizing: 'border-box',
    flexShrink: 0,
    width: tap,
    minWidth: tap,
    minHeight: tap,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginInlineStart: 'calc(0px - var(--space-8))',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)',
    // Decorative aria-hidden chevron: unitless single-em line box centres the glyph; the 48px hit
    // box is independent of line-height.
    lineHeight: 1,
    textDecoration: 'none',
    ':focus-visible': focus
  },
  content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)', minWidth: 0 },
  confirmBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-text)',
    opacity: 0.6
  },
  confirmViewport: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-16)',
    overflowY: 'auto'
  },
  confirmDialog: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    width: 'min(100%, calc(var(--space-40) * 9))',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    overflowWrap: 'anywhere'
  },
  confirmTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  messageForm: { display: 'grid', gap: 'var(--space-8)' },
  messageTextarea: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) * 3)',
    padding: 'var(--space-12) var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    resize: 'vertical',
    ':focus-visible': focus
  },
  banner: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)'
  },
  copy: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'var(--space-12)',
    padding: 'var(--space-14)'
  },
  emptyState: { color: 'var(--color-muted)', textAlign: 'center' },
  errorActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  errorAction: {
    boxSizing: 'border-box',
    minHeight: control,
    flex: '1 1 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 'var(--space-16)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    font: 'inherit',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': focus,
    ':disabled': { opacity: 0.6 }
  },
  requestCard: { gap: 'var(--space-12)' },
  requestHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)', minWidth: 0 },
  requestIdentity: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 'var(--space-2)',
    minWidth: 0
  },
  requestMessageTrigger: {
    flexShrink: 0,
    width: tap,
    minWidth: tap,
    minHeight: tap,
    paddingInline: 0
  },
  requestMeta: { fontSize: 'var(--font-size-13)' },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  cardCompactTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-snug)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  sheetViewport: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  sheetPopup: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    maxHeight: '100%',
    overflowY: 'auto',
    paddingBlockStart: 'var(--space-10)',
    paddingInlineStart: 'max(var(--space-16), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-16), env(safe-area-inset-right))',
    paddingBlockEnd: 'calc(var(--space-20) + var(--space-8) + env(safe-area-inset-bottom))',
    borderRadius: sheetRadius,
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowWrap: 'anywhere'
  },
  sheetGrabber: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 'calc(var(--space-12) + var(--space-2))'
  },
  sheetGrab: {
    width: 'var(--space-40)',
    height: 'var(--space-5)',
    borderRadius: 'var(--space-3)',
    backgroundColor: 'var(--color-hairline)'
  },
  sheetHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    paddingBlockStart: 0,
    paddingInline: 'var(--space-8)',
    paddingBlockEnd: 'var(--space-6)'
  },
  sheetTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere',
    ':focus-visible': focus
  },
  sheetMeta: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  sheetRow: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingBlock: 'var(--space-8)',
    paddingInline: 'var(--space-12)',
    borderWidth: 0,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    textAlign: 'start',
    textDecoration: 'none',
    cursor: 'pointer',
    ':focus-visible': focus,
    '[aria-disabled="true"]': { cursor: 'default', opacity: 0.6 }
  },
  sheetRowDescribed: { minHeight: 'calc(var(--space-40) + var(--space-20))' },
  sheetGlyph: {
    boxSizing: 'border-box',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) - var(--space-4))',
    height: 'calc(var(--space-40) - var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1
  },
  sheetRowText: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    gap: 'var(--space-1)',
    minWidth: 0
  },
  sheetRowTitle: {
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  sheetRowTitleDanger: { color: 'var(--color-red)' },
  sheetRowHint: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  sheetClose: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    ':focus-visible': {
      position: 'static',
      width: 'auto',
      height: 'auto',
      minHeight: tap,
      clipPath: 'none',
      ...focus
    }
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  requestActions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  searchForm: { display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 'var(--space-8)' },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  unavailableInvite: { color: 'var(--color-muted)', ':disabled': { opacity: 1 } },
  listSurface: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    overflow: 'hidden'
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'var(--space-12)',
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) * 2 - var(--space-12))',
    padding: 'var(--space-12) var(--space-16)',
    borderWidth: 0,
    borderBlockEndWidth: { default: 'var(--border-width-sm)', ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-hairline)',
    borderRadius: 0,
    backgroundColor: 'transparent'
  },
  memberDetails: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 'var(--space-2)',
    minWidth: 0
  },
  avatar: {
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-16))',
    height: 'calc(var(--space-20) + var(--space-16))',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  avatarLarge: {
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    fontSize: 'var(--font-size-16)'
  },
  filterTabs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-8)',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0
  },
  filterTab: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    font: 'inherit',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focus
  },
  filterTabSelected: {
    borderColor: 'var(--color-green)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  memberRowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  roleBadge: {
    flexShrink: 0,
    padding: 'var(--space-4) var(--space-10)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  memberLink: {
    position: 'relative',
    color: 'var(--color-text)',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    '::before': {
      content: "''",
      position: 'absolute',
      left: 'calc(-1 * var(--space-4))',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 'calc(100% + var(--space-8))',
      minWidth: tap,
      height: tap
    },
    ':focus-visible': focus,
    '@media (max-width: 360px)': {
      display: 'inline-flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      minWidth: tap,
      minHeight: tap,
      paddingInline: 'var(--space-4)'
    }
  },
  inlineLink: {
    color: 'var(--color-green-ink)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-2)'
  },
  venueActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)' },
  venueCard: { gap: 'var(--space-10)', padding: 'var(--space-10)' },
  venueHead: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)', minWidth: 0 },
  venuePhoto: {
    flexShrink: 0,
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-12))',
    objectFit: 'cover',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)'
  },
  venueMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    flexWrap: 'wrap'
  },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)', minWidth: 0 },
  searchField: { flex: 1, minWidth: 0 },
  settingsForm: { gap: 'var(--space-14)' },
  fieldLabel: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  settingsCard: {
    boxSizing: 'border-box',
    minHeight: tap,
    justifyContent: 'center',
    gap: 'var(--space-6)',
    padding: 'var(--space-12) var(--space-16)'
  },
  settingChoice: {
    boxSizing: 'border-box',
    minHeight: control,
    width: '100%',
    paddingInline: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    font: 'inherit',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'start',
    scrollMarginBottom: `calc(${navClearance} + var(--space-4))`,
    ':focus-visible': focus
  },
  settingsDefaultsCard: { gap: 'var(--space-4)', padding: 'var(--space-8) var(--space-16)' },
  settingsTimezoneRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)',
    minHeight: control
  },
  settingsCurrencyRow: {
    margin: 0,
    paddingBlockEnd: 'var(--space-8)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  settingsLeagueRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)',
    minHeight: control
  },
  settingsLeagueCopy: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    minWidth: 0
  },
  settingsLeagueNote: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  settingsFooterNote: {
    flex: 1,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)',
    textAlign: 'end'
  },
  settingsTimezoneSelect: { width: 'min(60%, 14rem)' },
  settingsSaveControl: { scrollMarginBottom: `calc(${navClearance} + var(--space-4))` },
  settingsSwitch: {
    boxSizing: 'border-box',
    flexShrink: 0,
    width: tap,
    minWidth: tap,
    // 48px hit box around the 28px frame track (content box only carries the track fill).
    height: tap,
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: 'var(--space-10)',
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-36)',
    backgroundClip: 'content-box',
    backgroundColor: 'var(--color-line)',
    transition: 'background-color 150ms ease',
    ':focus-visible': focus
  },
  settingsSwitchThumb: {
    width: 'var(--space-20)',
    height: 'var(--space-20)',
    borderRadius: 'var(--radius-20)',
    marginInlineStart: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)',
    transform: 'translateX(0)',
    transition: 'transform 150ms ease'
  },
  settingsSwitchChecked: { backgroundColor: 'var(--color-green)' },
  settingsSwitchThumbChecked: { transform: 'translateX(var(--space-20))' },
  settingsTimezonePopup: {
    zIndex: 10,
    minWidth: 'calc(var(--space-40) * 4)',
    padding: 'var(--space-4)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)'
  },
  settingsTimezoneItem: {
    boxSizing: 'border-box',
    minHeight: tap,
    display: 'flex',
    alignItems: 'center',
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-10)',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'var(--color-surface-2)' },
    ':focus': { backgroundColor: 'var(--color-surface-2)', outline: 'none' }
  },
  settingTimezoneSelected: {
    color: 'var(--color-green-ink)',
    fontWeight: 'var(--font-weight-bold)'
  },
  details: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)', minWidth: 0 },
  detailsSummary: {
    minHeight: tap,
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    scrollMarginBottom: `calc(${navClearance} + var(--space-4))`,
    ':focus-visible': focus
  },
  note: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  auditDot: {
    flexShrink: 0,
    width: 'var(--space-10)',
    height: 'var(--space-10)',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-green)'
  },
  auditAction: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-snug)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  status: {
    margin: 0,
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  error: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  adminEntries: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    marginInline: 'auto',
    padding: 'var(--space-10) var(--space-20)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)'
  },
  adminEntryLink: {
    minHeight: tap,
    display: 'flex',
    alignItems: 'center',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere',
    ':focus-visible': focus
  },
  bottomNav: {
    position: 'fixed',
    zIndex: 1,
    left: '50%',
    bottom: 'max(var(--space-14), env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    boxSizing: 'border-box',
    width: 'min(calc(100% - var(--space-20) - var(--space-20)), calc(var(--space-40) * 16))',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    display: 'flex',
    alignItems: 'stretch',
    gap: 'var(--space-2)',
    padding: 'var(--space-3) var(--space-4)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  bottomNavLink: {
    flex: 1,
    minWidth: 0,
    minHeight: tap,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 'var(--space-2)',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    '[aria-current="page"]': {
      backgroundColor: 'var(--color-green-soft)',
      color: 'var(--color-green-ink)',
      fontWeight: 'var(--font-weight-bold)'
    },
    ':focus-visible': focus
  }
});
