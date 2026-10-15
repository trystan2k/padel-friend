import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
  page: {
    minHeight: '100%',
    padding: 'var(--space-6)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-background-primary)'
  },
  panel: {
    maxWidth: 'var(--size-content-lg)',
    marginInline: 'auto',
    padding: 'var(--space-6)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-3)',
    flexWrap: 'wrap',
    marginTop: 'var(--space-5)'
  },
  link: {
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--color-text-link)'
  },
  button: { minHeight: '44px', paddingInline: 'var(--space-4)' }
});
