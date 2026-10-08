import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  page: {
    boxSizing: 'border-box',
    height: '100vh',
    minHeight: '100vh',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-18) var(--space-18) var(--space-14)',
    paddingBottom: 'calc(var(--space-18) + var(--space-40) + var(--space-16))',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowY: 'auto'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  subtitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    overflowWrap: 'anywhere'
  },
  content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  venueContent: { gap: 'var(--space-10)' },
  screenHeading: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)' },
  titleGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 },
  backLink: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 1,
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  banner: {
    margin: 0,
    padding: 'var(--space-8) var(--space-10)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-bold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
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
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-size-15)',
    overflowWrap: 'anywhere'
  },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'var(--space-6)',
    padding: 'var(--space-14)'
  },
  requestCard: {
    minHeight: 'calc(var(--space-40) * 5)',
    boxSizing: 'border-box'
  },
  requestMeta: { minHeight: 'calc(var(--font-size-15) * 2)' },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  cardCompactTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  memberProfileTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  memberProfileCard: { minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-6))' },
  rolePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  rolePanelTitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)'
  },
  rolePanelCopy: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-size-15)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' },
  requestActions: { gap: 'var(--space-6)' },
  searchForm: { display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 'var(--space-6)' },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  unavailableInvite: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    ':disabled': { opacity: 1 }
  },
  memberList: { gap: 'var(--space-10)' },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'var(--space-8)',
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-11))',
    padding: 'var(--space-6) var(--space-10)'
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
    width: 'calc(var(--space-20) + var(--space-14))',
    height: 'calc(var(--space-20) + var(--space-14))',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-bold)'
  },
  filterTabs: {
    display: 'flex',
    gap: 'var(--space-4)',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0
  },
  filterTab: {
    flex: 1,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-8)',
    borderWidth: 0,
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    font: 'inherit',
    fontSize: 'var(--font-size-12)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  filterTabSelected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  memberRowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)'
  },
  roleBadge: {
    flexShrink: 0,
    padding: 'var(--space-4) var(--space-8)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-11)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  softAction: {
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    borderWidth: 0
  },
  memberLink: {
    position: 'relative',
    color: 'var(--color-green)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-2)',
    overflowWrap: 'anywhere',
    '::before': {
      content: "''",
      position: 'absolute',
      left: 'calc(-1 * var(--space-4))',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 'calc(100% + var(--space-8))',
      minWidth: 'calc(var(--space-40) + var(--space-4))',
      height: 'calc(var(--space-40) + var(--space-4))'
    },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  venueActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
  venueCard: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) * 2 + var(--space-20) + var(--space-14))',
    gap: 'var(--space-6)',
    padding: 'var(--space-14)'
  },
  venueAction: { backgroundColor: 'var(--color-surface-2)', borderWidth: 0 },
  venueMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)',
    flexWrap: 'wrap'
  },
  venueMapLink: { fontSize: 'var(--font-size-12)', lineHeight: 'var(--font-size-15)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  searchField: { flex: 1, minWidth: 0 },
  settingsForm: { gap: 'var(--space-10)' },
  fieldLabel: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  settingsCard: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 'var(--space-6)',
    padding: 'var(--space-12)'
  },
  settingChoice: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    width: '100%',
    paddingInline: 'var(--space-10)',
    borderWidth: 0,
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    font: 'inherit',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  settingsUnavailableCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    padding: 'var(--space-10)'
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  detailsSummary: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  note: {
    margin: 0,
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-size-15)',
    overflowWrap: 'anywhere'
  },
  auditCard: { gap: 'var(--space-4)' },
  auditAction: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  status: { margin: 0, color: 'var(--color-green)', fontSize: 'var(--font-size-14)' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-14)' },
  adminEntries: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-10) var(--space-18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)'
  },
  adminEntryLink: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  bottomNav: {
    position: 'fixed',
    zIndex: 1,
    left: '50%',
    bottom: 'var(--space-14)',
    transform: 'translateX(-50%)',
    boxSizing: 'border-box',
    width: 'min(calc(100% - var(--space-18) - var(--space-18)), calc(var(--space-40) * 12))',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    display: 'flex',
    alignItems: 'stretch',
    gap: 'var(--space-2)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)'
  },
  bottomNavLink: {
    flex: 1,
    minWidth: 0,
    minHeight: 'var(--space-40)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 'var(--space-2)',
    borderRadius: 'var(--radius-10)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-10)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    '[aria-current="page"]': {
      backgroundColor: 'var(--color-green-soft)',
      color: 'var(--color-green)',
      fontWeight: 'var(--font-weight-bold)'
    },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  }
});
