import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
  roster: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-2)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)'
  },
  highlighted: {
    borderInlineStartWidth: 'var(--border-width-lg)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--color-green)'
  },
  name: { margin: 0, fontWeight: 'var(--font-weight-semibold)' },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-2)'
  }
});
