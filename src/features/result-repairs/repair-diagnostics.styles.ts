import * as stylex from '@stylexjs/stylex';

// Pencil "Result Repair Diagnostics" frames (SluH3 desktop, cuVwp / Jjrtb mobile): header and
// scheduler health on top, then the repair queue with an adjacent detail column. The columns share
// the width fluidly on desktop and stack on mobile, queue first. Tokens only.
const desktop = '@media (min-width: 960px)';

export const repairDiagnostics = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    width: '100%',
    maxWidth: {
      default: 'calc(var(--space-40) * 12)',
      [desktop]: 'calc(var(--space-40) * 32)'
    },
    minHeight: '100vh',
    marginInline: 'auto',
    padding: {
      default: 'var(--space-18) var(--space-18) var(--space-14)',
      [desktop]: 'var(--space-40)'
    },
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  regions: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [desktop]: 'minmax(0, 3fr) minmax(0, 2fr)'
    },
    gap: {
      default: 'var(--space-10)',
      [desktop]: 'var(--space-20)'
    },
    alignItems: 'start',
    minWidth: 0
  },
  region: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
  // 28px on mobile, 32px on desktop (cuVwp / SluH3 "Repair diagnostics").
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: { default: 'var(--font-size-28)', [desktop]: 'var(--font-size-32)' },
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)',
    overflowWrap: 'anywhere'
  },
  // 20px queue and detail section headings.
  sectionHeading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-20)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  subHeading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'anywhere'
  },
  job: { display: 'grid', gap: 'var(--space-14)', minWidth: 0 },
  jobSelected: { borderColor: 'var(--color-green)' },
  jobSelect: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    padding: 0,
    borderWidth: 0,
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
  detailMeta: { display: 'grid', gap: 'var(--space-3)', margin: 0, minWidth: 0 },
  detailLabel: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  detailValue: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-medium)',
    overflowWrap: 'anywhere'
  },
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
    gap: 'var(--space-5)',
    minWidth: 0,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)',
    fontSize: 'var(--font-size-12)',
    overflowWrap: 'anywhere'
  }
});
