import * as stylex from '@stylexjs/stylex';

// D7: the same frame family serves community and platform diagnostics.
const desktop = '@media (min-width: 960px)';
const target = 'calc(var(--space-40) + var(--space-12))';

export const repairDiagnostics = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'start',
    gap: { default: 'var(--space-14)', [desktop]: 'var(--space-16)' },
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 32)',
    marginInline: 'auto',
    padding: { default: 'var(--space-20)', [desktop]: 'var(--space-40)' },
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-12)'
  },
  headerCopy: { flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 'var(--space-8)' },
  eyebrow: {
    margin: 0,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: target,
    minHeight: target,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    textDecoration: 'none',
    fontSize: 'var(--font-size-22)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  controlCompact: { width: 'fit-content', maxWidth: '100%' },
  regions: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [desktop]: 'minmax(0, 716fr) minmax(0, 460fr)'
    },
    gap: { default: 'var(--space-14)', [desktop]: 'calc(var(--space-12) * 2)' },
    alignItems: 'start',
    minWidth: 0
  },
  region: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-32)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'break-word'
  },
  sectionHeading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'break-word'
  },
  subHeading: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  card: {
    display: 'grid',
    gap: 'var(--space-12)',
    minWidth: 0,
    padding: 'var(--space-16)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  job: { display: 'grid', gap: 'var(--space-8)', minWidth: 0 },
  jobCard: { gap: 'var(--space-8)', borderRadius: 'var(--radius-18)' },
  jobSelected: { borderColor: 'var(--color-green)' },
  jobHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  jobHeading: { margin: 0, flex: '1 1 calc(var(--space-40) * 4)', minWidth: 0 },
  jobSelect: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: target,
    padding: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'start',
    overflowWrap: 'anywhere',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  muted: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    overflowWrap: 'break-word'
  },
  error: { margin: 0, color: 'var(--color-red)', overflowWrap: 'break-word' },
  notice: {
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-red-soft)',
    fontSize: 'var(--font-size-14)'
  },
  badge: {
    justifySelf: 'start',
    gap: 'var(--space-4)',
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    borderWidth: 0
  },
  detailMeta: {
    display: 'grid',
    margin: 0,
    minWidth: 0,
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)'
  },
  detailRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
    alignItems: 'center',
    gap: 'var(--space-8)',
    minWidth: 0,
    padding: 'var(--space-12) var(--space-14)'
  },
  rowDivider: {
    borderTopWidth: 'var(--border-width-sm)',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--color-hairline)'
  },
  detailLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    overflowWrap: 'break-word'
  },
  detailValue: {
    margin: 0,
    minWidth: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    overflowWrap: 'anywhere'
  },
  identifier: { overflowWrap: 'anywhere', whiteSpace: 'normal', userSelect: 'text' },
  timeline: {
    display: 'grid',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    minWidth: 0
  },
  attempt: {
    display: 'grid',
    gap: 'var(--space-4)',
    minWidth: 0,
    paddingBlockEnd: 'var(--space-12)',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-hairline)'
  },
  attemptDot: {
    width: 'var(--space-10)',
    height: 'var(--space-10)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-muted)'
  },
  attemptFailed: { backgroundColor: 'var(--color-red)' },
  attemptSucceeded: { backgroundColor: 'var(--color-green)' },
  attemptTitle: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-8)',
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)'
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
    gap: 'var(--space-4) var(--space-8)',
    margin: 0,
    minWidth: 0
  },
  table: {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-13)'
  },
  caption: {
    paddingBlockEnd: 'var(--space-8)',
    textAlign: 'start',
    color: 'var(--color-muted)'
  },
  cell: {
    padding: 'var(--space-8) var(--space-4)',
    textAlign: 'start',
    verticalAlign: 'top',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-hairline)',
    overflowWrap: 'anywhere'
  },
  retryPopup: { borderRadius: 'var(--radius-20)', backgroundColor: 'var(--color-surface-2)' },
  retryActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  retryAction: { flex: '1 1 calc(var(--space-40) * 3)', width: 'auto', minWidth: 0 }
});
