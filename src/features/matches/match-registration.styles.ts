import * as stylex from '@stylexjs/stylex';

// PAF-5.5 registration surface. Every value comes from a generated design token
// (semantic first, then primitive palette/space/typography); no literal colour,
// spacing, radius or type size is hardcoded here.
export const matchRegistrationStyles = stylex.create({
  panel: {
    display: 'grid',
    gap: 'var(--space-4)',
    padding: 'var(--space-5)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)',
    overflowWrap: 'anywhere'
  },
  header: { display: 'grid', gap: 'var(--space-2)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  body: { display: 'grid', gap: 'var(--space-3)' },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' },
  copy: { margin: 0, color: 'var(--color-text)' },
  meta: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  note: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-5)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-text)',
      outlineOffset: 'var(--space-1)'
    }
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  disabledButton: {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    cursor: 'not-allowed'
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-2)',
    color: 'var(--color-green)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-1)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  status: {
    display: 'block',
    minHeight: 'var(--space-5)',
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  counts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  roster: { display: 'grid', gap: 'var(--space-3)' },
  rosterSection: {
    display: 'grid',
    gap: 'var(--space-2)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)'
  },
  rosterTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-13)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    textTransform: 'uppercase'
  },
  queue: { display: 'grid', gap: 'var(--space-4)' },
  queueHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)'
  },
  queueSort: {
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-11)',
    letterSpacing: 'var(--font-letter-spacing-1-5)',
    color: 'var(--color-muted)'
  },
  requestList: { display: 'grid', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' },
  requestCard: {
    display: 'grid',
    gap: 'var(--space-2)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-surface-2)'
  },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderStyle: 'none'
  }
});
