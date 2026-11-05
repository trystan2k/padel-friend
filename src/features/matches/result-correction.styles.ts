import * as stylex from '@stylexjs/stylex';

// Pencil "Result amendment — request" (adujr), "corrected result review" (s5TRC) and "Community
// dispute resolution" (CWJkF): a status label, an official-vs-proposed pair of surface cards,
// and a stacked action list. Tokens only; every target is at least 44px.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';

export const resultCorrectionStyles = stylex.create({
  section: { display: 'grid', gap: 'var(--space-10)', minWidth: 0 },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  card: {
    display: 'grid',
    gap: 'var(--space-8)',
    minWidth: 0,
    padding: 'var(--space-11)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  banner: {
    display: 'block',
    margin: 0,
    padding: 'var(--space-8) var(--space-9)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase',
    overflowWrap: 'anywhere'
  },
  bannerDisputed: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-red)' },
  bannerPending: { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-amber)' },
  facts: { display: 'grid', gap: 'var(--space-3)', margin: 0, minWidth: 0 },
  factLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--font-letter-spacing-1-5)'
  },
  factValue: { margin: 0, fontWeight: 'var(--font-weight-semibold)', overflowWrap: 'anywhere' },
  proposed: { backgroundColor: 'var(--color-green-soft)' },
  muted: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  error: { margin: 0, color: 'var(--color-red)', overflowWrap: 'anywhere' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', minWidth: 0 },
  action: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '1 1 calc(var(--space-40) * 4)',
    minWidth: 0,
    minHeight: touchTarget,
    paddingInline: 'var(--space-9)',
    borderWidth: 0,
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    textDecoration: 'none',
    cursor: 'pointer',
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  primary: { backgroundColor: 'var(--color-green)', color: 'var(--color-bg)' },
  danger: { color: 'var(--color-red)' },
  list: {
    display: 'grid',
    gap: 'var(--space-6)',
    margin: 0,
    paddingInlineStart: 'var(--space-12)'
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    minHeight: touchTarget,
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  decisionOption: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-6)',
    minHeight: touchTarget,
    overflowWrap: 'anywhere'
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-12)' },
  cell: {
    padding: 'var(--space-4) var(--space-5)',
    textAlign: 'start',
    verticalAlign: 'top',
    borderBottomWidth: 'var(--border-width-sm)',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--color-line)',
    overflowWrap: 'anywhere'
  },
  tableScroll: { overflowX: 'auto', maxWidth: '100%' }
});
