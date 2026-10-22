import * as stylex from '@stylexjs/stylex';

export const matchManagementStyles = stylex.create({
  section: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-12)',
    overflowWrap: 'anywhere'
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)'
  },
  button: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    paddingBlock: 'var(--space-2)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-bg)',
    opacity: 0.8,
    zIndex: 20
  },
  popup: {
    position: 'fixed',
    insetInline: 'var(--space-16)',
    top: 'var(--space-40)',
    marginInline: 'auto',
    width: 'auto',
    maxWidth: 'calc(var(--space-40) * 14)',
    maxHeight: 'calc(100dvh - var(--space-40) - var(--space-40))',
    overflowY: 'auto',
    display: 'grid',
    gap: 'var(--space-16)',
    padding: 'var(--space-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-12)',
    zIndex: 21
  },
  menu: {
    padding: 'var(--space-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-8)',
    border: 'var(--border-width-sm) solid var(--color-line)'
  },
  input: {
    width: '100%',
    minHeight: 'calc(var(--space-40) * 2)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    border: 'var(--border-width-sm) solid var(--color-line)'
  }
});
