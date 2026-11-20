import * as stylex from '@stylexjs/stylex';

const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const rowBorder = {
  borderBottomWidth: 'var(--border-width-sm)',
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--color-hairline)'
} as const;

export const styles = stylex.create({
  headingRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)'
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(calc(var(--space-40) * 2), 1fr))',
    gap: 'var(--space-8)',
    margin: 0,
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)'
  },
  summaryStat: {
    display: 'flex',
    flexDirection: 'column-reverse',
    alignItems: 'center',
    gap: 'var(--space-2)',
    minWidth: 0,
    textAlign: 'center'
  },
  summaryLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  summaryValue: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  summaryValueAccent: { color: 'var(--color-green)' },
  tableCard: {
    overflow: 'hidden',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)'
  },
  scroll: {
    overflowX: 'auto',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    ':focus-visible': focusRing
  },
  table: {
    width: '100%',
    minWidth: 'calc(var(--space-40) * 11)',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-15)',
    fontVariantNumeric: 'tabular-nums'
  },
  compactTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--font-size-15)',
    fontVariantNumeric: 'tabular-nums'
  },
  compactPlayer: {
    textAlign: 'start',
    overflowWrap: 'anywhere'
  },
  detailsSummary: {
    display: 'flex',
    alignItems: 'center',
    minHeight: touchTarget,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  headCell: {
    ...rowBorder,
    padding: 'var(--space-8) var(--space-6)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    verticalAlign: 'bottom'
  },
  cell: {
    ...rowBorder,
    padding: 'var(--space-8) var(--space-6)',
    textAlign: 'center',
    minHeight: touchTarget
  },
  playerCell: {
    textAlign: 'start',
    minWidth: 'calc(var(--space-40) * 3)',
    overflowWrap: 'anywhere'
  },
  ownRow: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-text)' },
  position: { fontWeight: 'var(--font-weight-extrabold)' },
  playerName: { fontWeight: 'var(--font-weight-regular)' },
  tag: {
    marginInlineStart: 'var(--space-6)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  hidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  callout: {
    margin: 0,
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    padding: 'var(--space-8) var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    ':focus-visible': focusRing
  },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' },
  fieldLabel: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  auditList: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    overflow: 'hidden',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    backgroundColor: 'var(--color-surface)',
    fontSize: 'var(--font-size-15)'
  },
  auditItem: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--space-12) var(--space-16)',
    ...rowBorder,
    overflowWrap: 'anywhere'
  },
  linkRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' }
});
