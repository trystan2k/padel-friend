import * as stylex from '@stylexjs/stylex';

export const ui = stylex.create({
  page: {
    boxSizing: 'border-box',
    minHeight: '100vh',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-18) var(--space-18) var(--space-14)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)'
  },
  top: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-12)'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  subtitle: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
  content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
  intro: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' },
  createIntro: { gap: 'var(--space-4)' },
  lead: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)'
  },
  help: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  search: { position: 'relative' },
  hidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  searchInput: {
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    fontSize: 'var(--font-size-14)',
    paddingInline: 'var(--space-12)',
    paddingLeft: 'calc(var(--space-12) + var(--space-16) + var(--space-8))'
  },
  searchIcon: {
    position: 'absolute',
    left: 'var(--space-12)',
    bottom: 'var(--space-14)',
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    color: 'var(--color-muted)',
    pointerEvents: 'none'
  },
  card: {
    minHeight: 'calc(var(--space-40) * 3 + calc(var(--space-20) + var(--space-2)))',
    boxSizing: 'border-box',
    gap: 'var(--space-7)',
    padding: 'var(--space-14)'
  },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  meta: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  cardAction: {
    marginTop: 'auto',
    borderWidth: 0,
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)'
  },
  requestAction: { backgroundColor: 'transparent', color: 'var(--color-text)' },
  transparentAction: { backgroundColor: 'transparent', borderWidth: 0 },
  status: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-green)' },
  error: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-red)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)' },
  label: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-size-15)'
  },
  visibilityCard: { gap: 'var(--space-8)', padding: 'var(--space-14)' },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-7))',
    padding: 'var(--space-10)',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-bg)',
    cursor: 'pointer',
    ':focus-within': { outline: 'var(--border-width-lg) solid var(--color-green)' }
  },
  selected: { backgroundColor: 'var(--color-green-soft)' },
  radio: {
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    borderRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'var(--color-muted)',
    flexShrink: 0,
    '[data-checked]': { borderColor: 'var(--color-green)', backgroundColor: 'var(--color-green)' }
  },
  optionText: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  optionTitle: {
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-size-15)'
  },
  selectedTitle: { fontWeight: 'var(--font-weight-bold)' },
  optionHelp: {
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    lineHeight: 'var(--font-size-15)'
  },
  optional: { gap: 0, padding: 'var(--space-12)', borderRadius: 'var(--radius-14)' },
  optionalHeading: { marginBottom: 'var(--space-7)' },
  optionalInput: {
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    boxSizing: 'border-box',
    padding: 'var(--space-8)',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    ':focus-visible': { outline: 'var(--border-width-lg) solid var(--color-green)' },
    '::placeholder': { color: 'var(--color-muted)' }
  },
  divider: {
    borderTopWidth: 'var(--border-width-sm)',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-line)'
  }
});
