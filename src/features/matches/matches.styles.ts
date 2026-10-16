import * as stylex from '@stylexjs/stylex';

export const matchesStyles = stylex.create({
  page: {
    display: 'grid',
    gap: 'var(--space-5)',
    width: '100%',
    marginInline: 'auto',
    padding: 'var(--space-4)',
    color: 'var(--color-text)'
  },
  heading: { display: 'grid', gap: 'var(--space-2)' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-8)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  list: { display: 'grid', gap: 'var(--space-4)' },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  image: {
    width: '100%',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    borderRadius: 'var(--radius-8)'
  },
  photo: {
    width: '100%',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    borderRadius: 'var(--radius-8)'
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' },
  muted: { color: 'var(--color-muted)' },
  button: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
    borderRadius: 'var(--radius-8)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  input: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
    border: 'var(--border-width-sm) solid var(--color-line)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)'
  }
});
