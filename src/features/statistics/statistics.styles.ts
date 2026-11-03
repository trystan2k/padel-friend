import * as stylex from '@stylexjs/stylex';

// Shared statistics chart, disclosure and state styles. Tokens only; the 44px floor applies to every
// control and nothing relies on colour alone (values are always repeated as text and in the table).
const TOUCH = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const statisticsStyles = stylex.create({
  figure: { display: 'grid', gap: 'var(--space-6)', margin: 0, minWidth: 0 },
  summary: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)',
    overflowWrap: 'anywhere'
  },
  baseline: { stroke: 'var(--color-line)', strokeWidth: 1 },
  disclosureTrigger: {
    justifySelf: 'start',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  tableRegion: {
    overflowX: 'auto',
    maxWidth: '100%',
    marginTop: 'var(--space-6)',
    ':focus-visible': focusRing
  },
  state: {
    display: 'grid',
    gap: 'var(--space-6)',
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  errorState: {
    display: 'grid',
    gap: 'var(--space-6)',
    justifyItems: 'start',
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-12)'
  },
  breadcrumbList: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 'var(--space-6)',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  breadcrumbLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-semibold)',
    textDecoration: 'underline',
    ':focus-visible': focusRing
  },
  breadcrumbCurrent: { overflowWrap: 'anywhere' },
  retry: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingInline: 'var(--space-9)',
    borderWidth: 0,
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  }
});
