import * as stylex from '@stylexjs/stylex';

// Community statistics and the shared filter bar. Tokens only; every control keeps the 44px floor
// and grids are fluid so translated labels wrap instead of overflowing.
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const communityStyles = stylex.create({
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
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: TOUCH,
    paddingInline: 'var(--space-12)',
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    ':focus-visible': focusRing
  },
  fieldset: {
    display: 'grid',
    gap: 'var(--space-4)',
    margin: 0,
    padding: 0,
    border: 0,
    minWidth: 0
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  radios: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)' },
  radioOption: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-6)',
    minHeight: TOUCH,
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  radioSelected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  radio: {
    flexShrink: 0,
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    borderRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'var(--color-muted)',
    backgroundColor: 'transparent',
    padding: 0,
    '[data-checked]': { borderColor: 'var(--color-green)', backgroundColor: 'var(--color-green)' }
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  notice: {
    margin: 0,
    padding: 'var(--space-10)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)'
  },
  scroll: {
    overflowX: 'auto',
    maxWidth: '100%'
  },
  names: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }
});
