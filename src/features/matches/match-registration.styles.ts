import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';
const control = 'calc(var(--space-40) + var(--space-12))';

// Clubhouse registration, roster and request surfaces (frames fo8Zn, SYMLa, tYXlh, xC04T, CLn9x,
// Za6r4, Cpd7L, t1ywa): radius-18 cards, 52-high controls, radius-14 rows, sentence-case chips.
// Every value comes from a generated design token (semantic first, then primitive palette/space/
// typography); no literal colour, spacing, radius or type size is hardcoded here.
export const matchRegistrationStyles = stylex.create({
  panel: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-10)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  header: { display: 'grid', gap: 'var(--space-2)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  body: { display: 'grid', gap: 'var(--space-8)' },
  positive: { backgroundColor: 'var(--color-green-soft)' },
  placeBadge: {
    display: 'inline-flex',
    justifySelf: 'start',
    padding: 'var(--space-4) var(--space-10)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  positiveBadge: { backgroundColor: 'var(--color-surface)' },
  organizerBadge: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-muted)' },
  leaveButton: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: control,
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-red)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  overflowButton: {
    width: target,
    minHeight: target,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: 'var(--color-text)'
  },
  playerRow: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    minHeight: control,
    paddingBlock: 0,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)'
  },
  passivePlayerRow: { minHeight: 'calc(var(--space-40) + var(--space-8))' },
  playerHighlight: { backgroundColor: 'var(--color-green-soft)' },
  playerIdentity: { display: 'grid', gap: 'var(--space-2)', flexGrow: 1, minWidth: 0 },
  playerName: { fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  provisionalSlot: { justifySelf: 'start' },
  initials: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-16))',
    height: 'calc(var(--space-20) + var(--space-16))',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  ownInitials: { backgroundColor: 'var(--color-green)', color: 'var(--color-on-green)' },
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
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)'
  },
  badgeRow: {
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-6)',
    alignItems: 'center'
  },
  reconfirmSummary: { margin: 0, fontWeight: 'var(--font-weight-semibold)' },
  copy: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  meta: {
    margin: 0,
    fontSize: 'var(--font-size-13)',
    color: 'var(--color-muted)'
  },
  note: {
    margin: 0,
    fontSize: 'var(--font-size-13)',
    lineHeight: {
      default: 'inherit',
      [stylex.when.ancestor('[data-result-entry="available"]')]: 'var(--space-15)'
    },
    color: 'var(--color-muted)'
  },
  actions: { display: 'grid', gap: 'var(--space-8)', justifyItems: 'stretch' },
  actionsPair: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-8)'
  },
  secondaryButton: {
    boxSizing: 'border-box',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: control,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: control,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  status: {
    display: 'block',
    fontSize: 'var(--font-size-13)',
    color: 'var(--color-muted)',
    ':empty': { display: 'none' }
  },
  counts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    margin: 0,
    fontSize: 'var(--font-size-13)',
    color: 'var(--color-muted)'
  },
  roster: { display: 'grid', gap: 'var(--space-4)' },
  rosterSection: {
    display: 'grid',
    gap: 'var(--space-8)'
  },
  rosterTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-14)',
    lineHeight: {
      default: 'inherit',
      [stylex.when.ancestor('[data-result-entry="available"]')]: 'var(--space-14)'
    }
  },
  queue: { display: 'grid', gap: 'var(--space-8)' },
  queueHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  queueSort: {
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    color: 'var(--color-muted)'
  },
  requestList: { display: 'grid', gap: 'var(--space-8)', margin: 0, padding: 0, listStyle: 'none' },
  requestCard: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
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
