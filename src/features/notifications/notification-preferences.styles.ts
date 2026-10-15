import * as stylex from '@stylexjs/stylex';

export const preferenceStyles = stylex.create({
  page: {
    minHeight: '100%',
    padding: 'var(--space-6)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-background-primary)'
  },
  panel: {
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-6)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
  },
  back: {
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--color-text-link)'
  },
  context: { marginBlock: 'var(--space-4)', color: 'var(--color-text-secondary)' },
  group: { border: 0, padding: 0, marginBlock: 'var(--space-6)' },
  legend: { fontWeight: 'var(--font-weight-semibold)', marginBlockEnd: 'var(--space-3)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingBlock: 'var(--space-2)',
    borderBlockEnd: 'var(--border-width-sm) solid var(--color-line)'
  },
  copy: { minWidth: 0, overflowWrap: 'anywhere' },
  helper: { color: 'var(--color-text-secondary)', marginBlockStart: 'var(--space-2)' },
  switch: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    display: 'inline-flex',
    alignItems: 'center',
    padding: 'var(--space-2)',
    border: 0,
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-muted)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  checked: { backgroundColor: 'var(--color-green)' },
  thumb: {
    width: 'var(--space-20)',
    height: 'var(--space-20)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    transform: 'translateX(0)'
  },
  thumbChecked: { transform: 'translateX(var(--space-16))' },
  always: {
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)'
  },
  save: { minHeight: '44px', paddingInline: 'var(--space-4)' }
});
