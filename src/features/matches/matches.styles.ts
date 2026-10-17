import * as stylex from '@stylexjs/stylex';

export const matchesStyles = stylex.create({
  page: {
    display: 'grid',
    gap: 'var(--space-8)',
    width: '100%',
    marginInline: 'auto',
    padding: 'var(--space-18)',
    color: 'var(--color-text)'
  },
  heading: { display: 'grid', gap: 'var(--space-2)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  tabs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
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
  activeLink: {
    backgroundColor: 'var(--color-surface)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-1)'
  },
  list: { display: 'grid', gap: 'var(--space-8)' },
  card: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  detailSurface: {
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
  },
  detailGroups: { display: 'grid', gap: 'var(--space-8)' },
  detailGroup: {
    display: 'grid',
    gap: 'var(--space-3)',
    padding: 'var(--space-18)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
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
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  primaryAction: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    textDecoration: 'none',
    fontWeight: 'var(--font-weight-semibold)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-text)',
      outlineOffset: 'var(--space-1)'
    }
  },
  cardLink: {
    color: 'var(--color-green)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-1)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  empty: {
    display: 'grid',
    justifyItems: 'start',
    gap: 'var(--space-3)',
    padding: 'var(--space-5)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)'
  },
  input: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-3)',
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
