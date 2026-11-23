import * as stylex from '@stylexjs/stylex';

const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;
const touchTarget = 'calc(var(--space-40) + var(--space-4))';

export const styles = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-4) var(--space-20) var(--space-20)',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 },
  backLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: touchTarget,
    minHeight: touchTarget,
    width: 'calc(var(--space-40) + var(--space-8))',
    height: 'calc(var(--space-40) + var(--space-8))',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  backIcon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  context: {
    margin: 0,
    paddingInlineStart: 'var(--space-12)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'anywhere'
  },
  // The shared top bar bleeds out of the page gutter; its context line centers under the title.
  barFrame: { marginInline: 'calc(-1 * var(--space-20))' },
  // The page gap would separate the line from the bar; tuck it up under the centered title.
  contextCenter: {
    paddingInlineStart: 0,
    marginBlockStart: 'calc(-1 * var(--space-8))',
    textAlign: 'center'
  },
  content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)', minWidth: 0 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  // Form fields sit directly on the page in the creation frame (ik5JC): no card chrome.
  flatCard: {
    gap: 'var(--space-14)',
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  fieldset: {
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)'
  },
  modeGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' },
  mode: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    minHeight: touchTarget,
    padding: 'var(--space-7) var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  modeSelected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  modeDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  radio: {
    flexShrink: 0,
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    borderRadius: 'var(--radius-20)',
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'var(--color-muted)',
    backgroundColor: 'transparent',
    padding: 0,
    '[data-checked]': { borderColor: 'var(--color-green)', backgroundColor: 'var(--color-green)' }
  },
  modeText: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  modeTitle: { fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-bold)' },
  modeHelp: { color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  summary: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)'
  },
  muted: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  formerNotice: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-12)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  formerGlyph: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)'
  },
  formerIcon: {
    width: 'var(--space-17)',
    height: 'var(--space-17)'
  },
  formerCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    flex: '1 1 calc(var(--space-40) * 3)',
    minWidth: 0
  },
  formerTitle: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  text: { margin: 0, fontSize: 'var(--font-size-15)', overflowWrap: 'anywhere' },
  strongText: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)',
    overflowWrap: 'anywhere'
  },
  guidance: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    ':focus-visible': focusRing
  },
  conflict: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  conflictHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)', minWidth: 0 },
  conflictGlyph: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-red-soft)',
    color: 'var(--color-red)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  errorText: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  successText: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  actionLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  primaryLink: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget,
    paddingInline: 'var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    ':focus-visible': focusRing
  },
  secondaryLink: {
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  itemLink: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    minHeight: touchTarget,
    padding: 'var(--space-12) var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  entryGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  itemHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)'
  },
  itemName: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    minWidth: 0
  },
  blocked: { color: 'var(--color-amber)', fontSize: 'var(--font-size-14)', margin: 0 },
  correctionNotice: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-amber-soft)',
    color: 'var(--color-amber)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  details: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
    columnGap: 'var(--space-10)',
    rowGap: 'var(--space-4)',
    margin: 0,
    fontSize: 'var(--font-size-14)'
  },
  counterStats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-8) var(--space-14)',
    margin: 0,
    fontSize: 'var(--font-size-14)'
  },
  counterStat: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 },
  detailLabel: { color: 'var(--color-muted)', margin: 0 },
  detailValue: { margin: 0, overflowWrap: 'anywhere' },
  dialogBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-text)',
    opacity: 0.6
  },
  dialogViewport: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-20)',
    overflowY: 'auto'
  },
  dialog: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    width: 'min(100%, calc(var(--space-40) * 9))',
    padding: 'calc(var(--space-12) * 2)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  dialogTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  dialogBody: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-16)' },
  dialogActions: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  destructiveSolid: {
    borderColor: 'var(--color-red)',
    backgroundColor: 'var(--color-red)',
    color: 'var(--color-bg)'
  },
  textarea: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) * 2)',
    padding: 'var(--space-12)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    resize: 'vertical',
    ':focus-visible': focusRing,
    '[aria-invalid="true"]': { borderColor: 'var(--color-red)' }
  }
});
