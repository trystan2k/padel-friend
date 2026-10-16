import * as stylex from '@stylexjs/stylex';

export const createMatchStyles = stylex.create({
  page: {
    display: 'grid',
    gap: 'var(--space-5)',
    width: '100%',
    marginInline: 'auto',
    padding: 'var(--space-4)',
    color: 'var(--color-text)'
  },
  form: { display: 'grid', gap: 'var(--space-4)' },
  fields: { display: 'grid', gap: 'var(--space-3)' },
  field: { display: 'grid', gap: 'var(--space-1)' },
  input: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    width: '100%',
    paddingInline: 'var(--space-3)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' },
  button: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  touchLabel: {
    display: 'flex',
    alignItems: 'center',
    minBlockSize: 'calc(var(--space-40) + var(--space-4))',
    paddingBlock: 'var(--space-2)'
  },
  fileInput: { minBlockSize: 'calc(var(--space-40) + var(--space-4))' },
  photo: {
    width: '100%',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    borderRadius: 'var(--radius-8)'
  },
  error: { color: 'var(--color-text)' },
  muted: { color: 'var(--color-muted)' },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)'
  }
});
