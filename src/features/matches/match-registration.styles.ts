import * as stylex from '@stylexjs/stylex';

// PAF-5.5 registration surface. Every value comes from a generated design token
// (semantic first, then primitive palette/space/typography); no literal colour,
// spacing, radius or type size is hardcoded here.
export const matchRegistrationStyles = stylex.create({
  panel: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  header: { display: 'grid', gap: 'var(--space-2)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-semibold)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'calc(var(--font-size-14) + var(--space-6))'
  },
  body: { display: 'grid', gap: 'var(--space-8)' },
  positive: { backgroundColor: 'var(--color-green-soft)' },
  fullWidth: { width: '100%' },
  placeBadge: {
    display: 'inline-flex',
    justifySelf: 'start',
    padding: 'var(--space-4) var(--space-8)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-10)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase'
  },
  positiveBadge: { backgroundColor: 'var(--color-surface)' },
  organizerBadge: {
    lineHeight: 'var(--font-size-12)',
    letterSpacing: 'calc(var(--font-size-10) * 0.08)'
  },
  leaveButton: {
    width: '100%',
    textTransform: 'uppercase',
    borderWidth: 0,
    fontWeight: 'var(--font-weight-bold)'
  },
  overflowButton: {
    width: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent'
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingBlock: 0,
    paddingInline: 'var(--space-6)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)'
  },
  passivePlayerRow: { minHeight: 'calc(var(--space-20) + var(--space-12))' },
  playerHighlight: { backgroundColor: 'var(--color-green-soft)' },
  playerIdentity: { display: 'grid', gap: 'var(--space-2)', flexGrow: 1, minWidth: 0 },
  playerName: { fontWeight: 'var(--font-weight-semibold)' },
  provisionalSlot: { justifySelf: 'start' },
  initials: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-10)'
  },
  ownInitials: { backgroundColor: 'var(--color-green)', color: 'var(--color-surface)' },
  reconfirmTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    color: 'var(--color-green)'
  },
  refreshIcon: { width: 'var(--space-18)', height: 'var(--space-18)', flexShrink: 0 },
  reconfirmPlayer: {
    display: 'grid',
    gap: 'var(--space-4)',
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)'
  },
  badgeRow: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    alignItems: 'center'
  },
  reconfirmSummary: { margin: 0, fontWeight: 'var(--font-weight-semibold)' },
  copy: { margin: 0, color: 'var(--color-muted)' },
  meta: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  note: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    lineHeight: {
      default: 'inherit',
      [stylex.when.ancestor('[data-result-entry="available"]')]: 'var(--space-15)'
    },
    color: 'var(--color-muted)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' },
  primaryButton: {
    borderWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-5)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    textTransform: 'uppercase',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-text)',
      outlineOffset: 'var(--space-1)'
    }
  },
  secondaryButton: {
    borderWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  disabledButton: {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    cursor: 'not-allowed'
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-2)',
    color: 'var(--color-green)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-1)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  status: {
    display: 'block',
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    ':empty': { display: 'none' }
  },
  counts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  roster: { display: 'grid', gap: 'var(--space-4)' },
  rosterSection: {
    display: 'grid',
    gap: 'var(--space-4)'
  },
  rosterTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-semibold)',
    fontSize: 'var(--font-size-10)',
    lineHeight: {
      default: 'inherit',
      [stylex.when.ancestor('[data-result-entry="available"]')]: 'var(--space-14)'
    },
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase'
  },
  queue: { display: 'grid', gap: 'var(--space-8)' },
  queueHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)'
  },
  queueSort: {
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-11)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    color: 'var(--color-muted)'
  },
  requestList: { display: 'grid', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' },
  requestCard: {
    display: 'grid',
    gap: 'var(--space-2)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)'
  },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderStyle: 'none'
  }
});
