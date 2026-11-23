import * as stylex from '@stylexjs/stylex';

const target = 'calc(var(--space-40) + var(--space-4))';
const control = 'calc(var(--space-40) + var(--space-12))';
const gutterStart = 'max(var(--space-20), env(safe-area-inset-left))';
const gutterEnd = 'max(var(--space-20), env(safe-area-inset-right))';
const focusRing = {
  outline: 'var(--focus-width) solid var(--color-focus)',
  outlineOffset: 'var(--focus-offset)'
};

// Clubhouse create wizard (frames wHaAb, vAxZh, b5RR4, RDV2r): top bar, four-segment progress, 14-unit
// content rhythm inside a 20-unit gutter, 52-unit controls on radius-12 line-bordered surfaces, segmented
// two-option groups on surface-2, hairline list cards, and a sticky action bar that owns the bottom
// safe-area inset because the shell suppresses the bottom navigation on this wizard.
export const createMatchStyles = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    minHeight: '100dvh',
    marginInline: 'auto',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere'
  },
  // The wizard and edit routes opt into data-route-chrome="navigation", so the global chips step aside
  // and the bar reserves no width for them.
  topBar: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingBlockStart: 'max(var(--space-4), env(safe-area-inset-top))',
    paddingInlineStart: 'max(var(--space-8), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-8), env(safe-area-inset-right))'
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-8))',
    height: 'calc(var(--space-40) + var(--space-8))',
    padding: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  backIcon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  title: {
    margin: 0,
    minWidth: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  form: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 },
  content: {
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'start',
    gap: 'var(--space-14)',
    flexGrow: 1,
    minWidth: 0,
    paddingInlineStart: gutterStart,
    paddingInlineEnd: gutterEnd,
    paddingBlockStart: 'var(--space-4)',
    paddingBlockEnd: 'var(--space-20)'
  },
  centered: {
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'start',
    gap: 'var(--space-14)',
    paddingInlineStart: gutterStart,
    paddingInlineEnd: gutterEnd,
    paddingBlockEnd: 'var(--space-20)'
  },
  progress: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-6)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  segmentDone: {
    flexGrow: 1,
    flexBasis: 0,
    height: 'var(--space-6)',
    borderRadius: 'var(--radius-5)',
    backgroundColor: 'var(--color-green)'
  },
  segmentTodo: {
    flexGrow: 1,
    flexBasis: 0,
    height: 'var(--space-6)',
    borderRadius: 'var(--radius-5)',
    backgroundColor: 'var(--color-surface-2)'
  },
  stepLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-22)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  fields: { display: 'grid', gap: 'var(--space-14)', minWidth: 0 },
  field: {
    display: 'grid',
    gap: 'var(--space-6)',
    minWidth: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    minWidth: 0,
    minHeight: control,
    paddingInline: 'var(--space-14)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: {
      default: 'var(--color-line)',
      '[aria-invalid="true"]': 'var(--color-red)'
    },
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-regular)',
    scrollMarginBlockEnd: 'calc(var(--space-40) * 3)',
    ':focus-visible': focusRing
  },
  fieldError: {
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  group: {
    display: 'grid',
    gap: 'var(--space-8)',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0
  },
  legend: {
    padding: 0,
    marginBlockEnd: 'var(--space-8)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  hidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0
  },
  levels: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-12)'
  },
  // Checkbox rows: the label is the whole 52-unit hit area; the text wraps inside it, so translated copy
  // can never push the row past its container (the checkbox keeps its size, the text shrinks).
  touchLabel: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    maxInlineSize: '100%',
    minInlineSize: target,
    minBlockSize: control,
    paddingInline: 'var(--space-14)',
    paddingBlock: 'var(--space-8)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere',
    cursor: 'pointer'
  },
  check: {
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-2))',
    height: 'calc(var(--space-20) + var(--space-2))',
    margin: 0,
    accentColor: 'var(--color-green)'
  },
  // Segmented two-option groups (frames Segmented · b5RR4): the native radio stays the real,
  // transparent, full-size hit target so keyboard and pointer behavior are unchanged.
  segmented: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'stretch',
    gap: 'var(--space-4)',
    width: '100%',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)'
  },
  segment: {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    paddingInline: 'var(--space-8)',
    paddingBlock: 'var(--space-4)',
    borderRadius: 'var(--radius-11)',
    backgroundColor: {
      default: 'transparent',
      [stylex.when.descendant(':checked')]: 'var(--color-surface)'
    },
    color: {
      default: 'var(--color-muted)',
      [stylex.when.descendant(':checked')]: 'var(--color-text)'
    },
    outlineStyle: {
      default: 'none',
      [stylex.when.descendant(':focus-visible')]: 'solid'
    },
    outlineWidth: 'var(--focus-width)',
    outlineColor: 'var(--color-focus)',
    outlineOffset: 'var(--focus-offset)',
    opacity: {
      default: 1,
      [stylex.when.descendant(':disabled')]: 0.5
    },
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    textAlign: 'center',
    overflowWrap: 'anywhere',
    cursor: 'pointer'
  },
  segmentInput: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    opacity: 0,
    cursor: 'inherit'
  },
  fileInput: {
    boxSizing: 'border-box',
    minInlineSize: 0,
    maxInlineSize: '100%',
    inlineSize: '100%',
    minBlockSize: control,
    paddingInline: 'var(--space-14)',
    paddingBlock: 'var(--space-6)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    ':focus-visible': focusRing
  },
  photo: {
    width: '100%',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    borderRadius: 'var(--radius-14)'
  },
  muted: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-body)'
  },
  formMessage: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  list: {
    boxSizing: 'border-box',
    display: 'grid',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    overflow: 'hidden',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)'
  },
  row: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingInline: 'var(--space-14)',
    borderBlockStartWidth: { default: 'var(--border-width-sm)', ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  rowAction: {
    boxSizing: 'border-box',
    width: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-15)',
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': { ...focusRing, outlineOffset: 'calc(-1 * var(--focus-width))' }
  },
  avatar: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-20) + var(--space-12))',
    height: 'calc(var(--space-20) + var(--space-12))',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  name: { flexGrow: 1, minWidth: 0, fontSize: 'var(--font-size-15)' },
  chip: {
    boxSizing: 'border-box',
    flexShrink: 0,
    minHeight: target,
    paddingInline: 'var(--space-12)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  reviewRow: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)',
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    paddingInline: 'var(--space-16)',
    paddingBlock: 'var(--space-8)',
    borderBlockStartWidth: { default: 'var(--border-width-sm)', ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  reviewKey: {
    margin: 0,
    flexShrink: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-regular)'
  },
  reviewValue: {
    margin: 0,
    minWidth: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'end'
  },
  actions: {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    boxSizing: 'border-box',
    display: 'flex',
    gap: 'var(--space-8)',
    marginBlockStart: 'auto',
    paddingInlineStart: gutterStart,
    paddingInlineEnd: gutterEnd,
    paddingBlockStart: 'var(--space-12)',
    paddingBlockEnd: 'calc(var(--space-20) + var(--space-4) + env(safe-area-inset-bottom, 0px))',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)'
  },
  secondaryAction: {
    width: 'auto',
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 'calc(var(--space-40) * 2 + var(--space-16) * 2)'
  },
  primaryAction: { width: 'auto', flexGrow: 1, flexBasis: 0, minWidth: 0 }
});
