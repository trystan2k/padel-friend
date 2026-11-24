import * as stylex from '@stylexjs/stylex';

export const recordResultStyles = stylex.create({
  page: {
    maxWidth: 'calc(var(--space-40) * 16)',
    paddingInline: 'var(--space-20)',
    gap: 'var(--space-12)',
    fontSize: 'var(--font-size-14)'
  },
  header: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) calc(var(--space-40) + var(--space-12))',
    alignItems: 'center',
    gap: 'var(--space-8)'
  },
  back: {
    position: 'static',
    backgroundColor: 'transparent',
    borderWidth: 0,
    fontSize: 'var(--font-size-24)',
    borderRadius: 'var(--radius-14)',
    width: 'calc(var(--space-40) + var(--space-12))',
    minHeight: 'calc(var(--space-40) + var(--space-12))'
  },
  title: {
    margin: 0,
    textAlign: 'center',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  progress: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    gap: 'var(--space-6)'
  },
  progressSegment: {
    minHeight: 'var(--space-6)',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-surface-2)'
  },
  progressReached: { backgroundColor: 'var(--color-green)' },
  selection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-12)'
  },
  selectionWide: { gridColumn: '1 / -1' },
  selectionNames: { display: 'grid', gap: 'var(--space-6)' },
  plainLabel: { textTransform: 'none', fontSize: 'var(--font-size-14)' },
  card: {
    borderRadius: 'var(--radius-18)',
    padding: 'var(--space-16)',
    gap: 'var(--space-12)'
  },
  matchups: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-8)',
    textAlign: 'center'
  },
  sets: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  scorePair: {
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      '@media (max-width: 359px)': 'minmax(0, 1fr)'
    }
  },
  mobileScoreLabel: {
    paddingBlock: {
      default: 0,
      '@media (max-width: 359px)': 'var(--space-4)'
    },
    display: {
      default: 'none',
      '@media (max-width: 359px)': 'block'
    }
  },
  setCard: {
    display: 'grid',
    gap: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-16)',
    paddingBlock: 'var(--space-6)',
    paddingInline: 'var(--space-6)',
    minWidth: 0
  },
  setHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    paddingInline: 'var(--space-6)'
  },
  field: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  stepButton: {
    padding: 0,
    width: 'calc(var(--space-40) + var(--space-12))',
    borderRadius: 'var(--radius-12)',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    font: 'inherit',
    fontSize: 'var(--font-size-18)',
    cursor: 'pointer',
    ':is([data-disabled], :disabled)': { color: 'var(--color-muted)', cursor: 'default' }
  },
  number: {
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    borderRadius: 'var(--radius-12)',
    padding: 0,
    fontVariantNumeric: 'tabular-nums'
  },
  setError: { paddingBlockStart: 'var(--space-6)', paddingInline: 'var(--space-6)' },
  outcome: {
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'start',
    backgroundColor: 'var(--color-surface-2)'
  },
  outcomeCopy: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  outcomeWin: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  outcomeIncomplete: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  outcomeIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 'calc(var(--space-16) * 2)',
    aspectRatio: '1',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)'
  },
  recapCard: { padding: 0, gap: 0 },
  recap: { gap: 0 },
  fact: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-6)',
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    paddingBlock: 'var(--space-10)',
    paddingInline: 'var(--space-16)',
    borderBlockEnd: 'var(--border-width-sm) solid var(--color-line)',
    ':last-child': { borderBlockEndWidth: 0 }
  },
  summaryScore: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  sticky: {
    display: 'flex',
    gap: 'var(--space-8)',
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    marginInline: 'calc(0px - var(--space-20))',
    paddingInline: 'var(--space-20)',
    paddingBlockStart: 'var(--space-12)',
    paddingBlockEnd: 'max(var(--space-12), env(safe-area-inset-bottom))',
    backgroundColor: 'var(--color-surface)',
    borderBlockStart: 'var(--border-width-sm) solid var(--color-line)'
  },
  footerBack: { width: 'auto', flex: '0 1 calc(var(--space-40) * 2 + var(--space-16) * 2)' },
  footerNext: {
    flex: '1 1 0',
    minWidth: 0,
    ':disabled': {
      backgroundColor: 'var(--color-surface-2)',
      color: 'var(--color-muted)',
      opacity: 1
    }
  },
  blocked: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'start',
    gap: 'var(--space-12)',
    color: 'var(--color-amber)',
    backgroundColor: 'var(--color-amber-soft)',
    borderRadius: 'var(--radius-18)',
    padding: 'var(--space-16)'
  },
  blockedCopy: { display: 'grid', gap: 'var(--space-8)' }
});
