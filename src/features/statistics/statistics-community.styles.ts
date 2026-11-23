import * as stylex from '@stylexjs/stylex';

// Community statistics and the shared filter bar. Tokens only; every control keeps the 44px floor
// and grids are fluid so translated labels wrap instead of overflowing.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const CONTROL = 'calc(var(--space-40) + var(--space-8))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const communityStyles = stylex.create({
  // The page gutter is 20px; the shared top bar brings its own 8px inset, so it bleeds to the edges.
  bar: { marginInline: 'calc(-1 * var(--space-20))' },
  // Scope chips (o9iaC1) with the jump to the real filter form that keeps the URL state actionable.
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 'var(--space-12)',
    rowGap: 'var(--space-4)',
    minWidth: 0
  },
  form: { display: 'grid', gap: 'var(--space-10)', minWidth: 0 },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  field: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  label: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: CONTROL,
    paddingInline: 'var(--space-14)',
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    ':focus-visible': focusRing
  },
  fieldset: {
    display: 'grid',
    gap: 'var(--space-4)',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    minWidth: 0
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  radios: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  // Filter chips (m8Loju): 48px pill, hairline outline; the selected chip is dark with a check mark.
  // The native radio stays in the tab order (visually hidden) so keyboard and screen readers keep
  // radio semantics; the label shows the focus ring.
  radioOption: {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-6)',
    minHeight: CONTROL,
    paddingInline: 'var(--space-18)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  radioSelected: {
    borderColor: 'var(--color-green-deep)',
    backgroundColor: 'var(--color-green-deep)',
    color: 'var(--color-on-hero)'
  },
  // Transparent radio stretched over the whole chip: the chip is the hit target.
  radio: {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-36)',
    opacity: 0,
    cursor: 'pointer'
  },
  check: { fontWeight: 'var(--font-weight-bold)' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  notice: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)'
  },
  scroll: {
    overflowX: 'auto',
    maxWidth: '100%'
  },
  names: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' },
  nameLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere',
    color: 'var(--color-text)',
    textDecoration: 'underline',
    ':focus-visible': focusRing
  }
});
