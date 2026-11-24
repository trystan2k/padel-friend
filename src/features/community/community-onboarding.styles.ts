import * as stylex from '@stylexjs/stylex';

export const ui = stylex.create({
  page: {
    boxSizing: 'border-box',
    minHeight: '100dvh',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    paddingInline: 'var(--space-20)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    display: 'flex',
    flexDirection: 'column'
  },
  top: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingBlockStart: 'env(safe-area-inset-top, 0px)'
  },
  back: {
    position: 'absolute',
    insetInlineStart: 0,
    width: 'auto',
    minWidth: 'calc(var(--space-40) + var(--space-12))',
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: 'transparent'
  },
  topTitle: {
    margin: 0,
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    paddingInline: 'calc(var(--space-40) + var(--space-12))'
  },
  // dSEX3's larger trailing reserve positions the title 12px left of center.
  discoveryTopTitle: {
    position: 'relative',
    insetInlineStart: 'calc(-1 * var(--space-12))'
  },
  content: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 'var(--space-12)',
    minWidth: 0,
    paddingBlockStart: 'var(--space-4)'
  },
  form: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 'var(--space-12)',
    paddingBlockStart: 'var(--space-4)'
  },
  progress: { display: 'flex', gap: 'var(--space-6)' },
  segment: {
    flex: 1,
    height: 'var(--space-6)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-green)'
  },
  step: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  help: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  adminNote: {
    margin: 0,
    color: 'var(--color-muted)',
    textAlign: 'center',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  search: { position: 'relative' },
  hidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  searchInput: {
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    boxSizing: 'border-box',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-16)',
    paddingInlineStart: 'calc(var(--space-14) + var(--space-20) + var(--space-10))',
    paddingInlineEnd: 'var(--space-14)',
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    },
    '::placeholder': { color: 'var(--color-muted)' }
  },
  searchIcon: {
    position: 'absolute',
    insetInlineStart: 'var(--space-14)',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 'var(--space-20)',
    height: 'var(--space-20)',
    color: 'var(--color-muted)',
    pointerEvents: 'none'
  },
  results: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  card: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-12)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-18)'
  },
  glyph: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontWeight: 'var(--font-weight-bold)'
  },
  cardDetails: { flex: '1 1 calc(var(--space-40) * 2)', minWidth: 0 },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  meta: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  cardAction: {
    width: 'auto',
    maxWidth: '100%',
    marginInlineStart: 'auto',
    paddingInline: 'var(--space-14)'
  },
  cardStatus: { flexBasis: '100%' },
  actions: {
    position: 'sticky',
    bottom: 0,
    display: 'grid',
    gap: 'var(--space-8)',
    marginBlockStart: 'auto',
    marginInline: 'calc(-1 * var(--space-20))',
    paddingInline: 'var(--space-20)',
    paddingBlockStart: 'var(--space-12)',
    paddingBlockEnd: 'calc(var(--space-12) * 2 + env(safe-area-inset-bottom, 0px))',
    backgroundColor: 'var(--color-surface)',
    borderTop: 'var(--border-width-sm) solid var(--color-line)'
  },
  transparentAction: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: 'var(--color-green)'
  },
  status: { margin: 0, fontSize: 'var(--font-size-14)', color: 'var(--color-green)' },
  error: { margin: 0, fontSize: 'var(--font-size-14)', color: 'var(--color-red)' },
  label: { fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  visibilityCard: { display: 'grid', gap: 'var(--space-12)' },
  radioGroup: { display: 'grid', gap: 'var(--space-12)' },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    minHeight: 'calc(var(--space-40) + var(--space-12) * 2 + var(--space-5))',
    padding: 'var(--space-14)',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    cursor: 'pointer',
    ':focus-within': { outline: 'var(--border-width-lg) solid var(--color-green)' }
  },
  selected: { borderColor: 'var(--color-green)' },
  radio: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-20) + var(--space-2))',
    height: 'calc(var(--space-20) + var(--space-2))',
    borderRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'var(--color-muted)',
    flexShrink: 0,
    '[data-checked]': {
      borderColor: 'var(--color-green)',
      borderWidth: 'var(--space-6)'
    }
  },
  optionText: { display: 'grid', gap: 'var(--space-2)', minWidth: 0 },
  optionTitle: { fontSize: 'var(--font-size-16)', fontWeight: 'var(--font-weight-bold)' },
  optionHelp: { fontSize: 'var(--font-size-14)', color: 'var(--color-muted)' }
});
