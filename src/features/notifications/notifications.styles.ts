import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
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
  button: { minHeight: '44px', paddingInline: 'var(--space-4)' },
  badgeLink: {
    minHeight: '44px',
    minWidth: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    paddingInline: 'var(--space-3)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    textDecoration: 'none'
  },
  unread: {
    borderInlineStartWidth: 'var(--border-width-lg)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--color-green)',
    backgroundColor: 'var(--color-green-soft)'
  },
  row: {
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    marginBlock: 'var(--space-3)'
  },
  filters: {
    display: 'flex',
    gap: 'var(--space-2)',
    flexWrap: 'wrap',
    marginBlock: 'var(--space-4)'
  }
});
