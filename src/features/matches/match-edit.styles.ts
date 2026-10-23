import * as stylex from '@stylexjs/stylex';

export const matchEditStyles = stylex.create({
  backdrop: { opacity: 0.97 },
  popup: {
    insetInline: 'var(--space-18)',
    top: 'calc(var(--space-40) * 2 + var(--space-8))',
    maxHeight: 'calc(100dvh - var(--space-40) * 2 - var(--space-8) - var(--space-18))',
    borderRadius: 'var(--radius-16)',
    gap: 'var(--space-16)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-line-height-body)',
    overscrollBehavior: 'contain'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)'
  },
  title: { margin: 0, fontSize: 'var(--font-size-18)', fontWeight: 'var(--font-weight-semibold)' },
  close: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    flexShrink: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-36)'
  },
  copy: { margin: 0, color: 'var(--color-muted)' },
  conflict: {
    display: 'grid',
    gap: 'var(--space-10)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  conflictHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    margin: 0,
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  warningIcon: {
    width: 'var(--space-18)',
    height: 'var(--space-18)',
    color: 'var(--color-amber)',
    flexShrink: 0
  },
  form: { display: 'grid', gap: 'var(--space-16)', minWidth: 0 },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-12)',
    borderWidth: 0,
    padding: 0,
    margin: 0,
    minWidth: 0
  },
  field: {
    display: 'grid',
    gap: 'var(--space-4)',
    minWidth: 0,
    fontWeight: 'var(--font-weight-semibold)'
  },
  input: {
    appearance: 'none',
    boxShadow: 'none',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-12)',
    paddingBlock: 'var(--space-8)',
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-regular)'
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-12)',
    minWidth: 0
  },
  button: {
    appearance: 'none',
    boxShadow: 'none',
    borderWidth: 0,
    borderStyle: 'none',
    backgroundColor: 'var(--color-surface-2)',
    textTransform: 'uppercase',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    ':disabled': { opacity: 0.45, cursor: 'default' }
  },
  primary: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    borderColor: 'var(--color-green)'
  },
  helper: { margin: 0, color: 'var(--color-amber)' }
});
