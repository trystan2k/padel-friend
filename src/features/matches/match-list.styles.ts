import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';
const control = 'calc(var(--space-40) + var(--space-12))';

// Clubhouse match lists (frames ENn8Q, kYI9H, uePpj, w25dY): 20px gutter, 12px rhythm, a 56px
// segmented track holding three 48px segments, day headers, and 18px-radius cards whose content
// reads time/price, venue, chips, participation.
export const matchListStyles = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-12)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    marginInline: 'auto',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    paddingBlockStart: 'max(var(--space-4), env(safe-area-inset-top))',
    paddingBlockEnd: 'var(--space-20)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowWrap: 'anywhere'
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    minHeight: target
  },
  title: {
    minWidth: 0,
    margin: 0,
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  newAction: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 'var(--space-4)',
    minHeight: target,
    minWidth: target,
    paddingInline: 'var(--space-16)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  segments: {
    boxSizing: 'border-box',
    display: 'grid',
    gridAutoColumns: 'minmax(0, 1fr)',
    gridAutoFlow: 'column',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)'
  },
  segment: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    paddingInline: 'var(--space-4)',
    borderRadius: 'var(--radius-11)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  segmentActive: { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' },
  list: { display: 'grid', gap: 'var(--space-12)' },
  group: { display: 'grid', gap: 'var(--space-8)' },
  day: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  dayTitle: {
    margin: 0,
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  dayCount: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  card: {
    boxSizing: 'border-box',
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  top: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  time: { fontSize: 'var(--font-size-22)', fontWeight: 'var(--font-weight-extrabold)' },
  zone: {
    marginInlineStart: 'var(--space-6)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  price: { fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  venue: { margin: 0, fontSize: 'var(--font-size-17)', fontWeight: 'var(--font-weight-bold)' },
  venueLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: target,
    color: 'var(--color-text)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)', alignItems: 'center' },
  // Lime is a fixed-light fill in both themes (frames ENn8Q, uePpj), so its label keeps the fixed
  // dark primitive ink rather than the theme-swapped text role.
  accentChip: { backgroundColor: 'var(--color-lime)', color: 'var(--palette-text)' },
  chipNote: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  meta: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.4
  },
  note: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  mapLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifySelf: 'start',
    minHeight: target,
    minWidth: target,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  empty: {
    boxSizing: 'border-box',
    display: 'grid',
    justifyItems: 'start',
    gap: 'var(--space-12)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)'
  },
  emptyIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) + var(--space-16))',
    height: 'calc(var(--space-40) + var(--space-16))',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)'
  },
  emptyTitle: { margin: 0, fontSize: 'var(--font-size-18)', fontWeight: 'var(--font-weight-bold)' },
  alert: {
    boxSizing: 'border-box',
    display: 'grid',
    justifyItems: 'start',
    gap: 'var(--space-8)',
    padding: 'var(--space-16)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-red-soft)',
    color: 'var(--color-text)'
  },
  primary: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: control,
    paddingInline: 'var(--space-16)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  fullWidth: { width: '100%' }
});
