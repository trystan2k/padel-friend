import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
  page: {
    minHeight: '100%',
    padding: 'var(--space-6)',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)'
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
    color: 'var(--color-green)'
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
    marginBlock: 'var(--space-4)',
    padding: 'var(--space-1)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)'
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    flexWrap: 'wrap'
  },
  headerActions: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    flexWrap: 'wrap',
    marginBlock: 'var(--space-5)'
  },
  pageTitle: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    marginBlock: 0
  },
  subtitle: {
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    marginBlock: 'var(--space-2)'
  },
  sectionTitle: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    marginBlock: 0
  },
  filterButton: {
    minHeight: '44px',
    paddingInline: 'var(--space-4)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'transparent',
    color: 'var(--color-muted)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  selectedFilter: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  cardTitle: { fontSize: 'var(--font-size-14)', marginBlock: 0 },
  cardMeta: { fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderStyle: 'none'
  }
});
