import * as stylex from '@stylexjs/stylex';

export const preferenceStyles = stylex.create({
  page: {
    minHeight: '100%',
    padding: 'var(--space-16)',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)'
  },
  panel: {
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)'
  },
  back: {
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none'
  },
  title: { fontSize: 'var(--font-size-20)', lineHeight: 'var(--font-line-height-tight)' },
  context: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  group: {
    boxSizing: 'border-box',
    width: '100%',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    padding: 'var(--space-16)',
    margin: 0,
    backgroundColor: 'var(--color-surface)'
  },
  legend: { fontSize: 'var(--font-size-12)', fontWeight: 'var(--font-weight-semibold)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    minHeight: '44px',
    paddingBlock: 'var(--space-2)',
    borderBlockEndWidth: 'var(--border-width-sm)',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-line)'
  },
  copy: { minWidth: 0, overflowWrap: 'anywhere' },
  helper: {
    color: 'var(--color-muted)',
    marginBlockStart: 'var(--space-8)',
    fontSize: 'var(--font-size-12)'
  },
  switch: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    display: 'inline-flex',
    alignItems: 'center',
    padding: 'var(--space-2)',
    borderWidth: 0,
    borderStyle: 'none',
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
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    borderInlineStartWidth: 'var(--border-width-lg)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--color-green)'
  },
  alwaysTitle: { margin: 0, fontSize: 'var(--font-size-14)' },
  alwaysCopy: { marginBlock: 'var(--space-4)', fontSize: 'var(--font-size-12)' },
  alwaysBadge: {
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-bold)'
  },
  save: { minHeight: '44px', paddingInline: 'var(--space-4)' }
});
