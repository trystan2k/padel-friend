import * as stylex from '@stylexjs/stylex';

export const centerStyles = stylex.create({
  panel: {
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    minWidth: 0
  },
  // The shared top bar owns the page edge (frame cAqsQ: 8 bar inset, 20 content gutter).
  content: {
    display: 'grid',
    gap: 'var(--space-12)',
    minWidth: 0,
    paddingInline: 'var(--space-20)',
    paddingBlockStart: 'var(--space-4)',
    paddingBlockEnd: 'var(--space-20)'
  },
  page: {
    minHeight: '100%',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)'
  },
  filters: { display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' },
  filter: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-36)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-13)'
  },
  selected: {
    backgroundColor: 'var(--color-text)',
    borderColor: 'var(--color-text)',
    color: 'var(--color-bg)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  summary: {
    display: 'flex',
    gap: 'var(--space-8)',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap'
  },
  group: { display: 'grid', gap: 'var(--space-8)' },
  groupTitle: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    backgroundColor: 'var(--color-surface)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)'
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: 'var(--space-8)',
    padding: 'var(--space-12) var(--space-14)',
    ':not(:last-child)': { borderBlockEnd: 'var(--border-width-sm) solid var(--color-hairline)' }
  },
  glyph: {
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 'var(--radius-12)',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-surface-2)',
    fontWeight: 'var(--font-weight-bold)'
  },
  positive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  warning: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  danger: { backgroundColor: 'var(--color-red-soft)', color: 'var(--color-red)' },
  dot: {
    width: 'var(--space-10)',
    height: 'var(--space-10)',
    marginBlockStart: 'var(--space-4)',
    backgroundColor: 'var(--color-green)',
    borderRadius: 'var(--radius-36)'
  },
  body: { minWidth: 0, overflowWrap: 'anywhere' },
  cardTitle: { fontSize: 'var(--font-size-16)', margin: 0 },
  meta: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-body)',
    margin: 0
  },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-8)' },
  textButton: {
    width: 'auto',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    color: 'var(--color-green-ink)'
  }
});
