import * as stylex from '@stylexjs/stylex';

export const matchResultStyles = stylex.create({
  page: {
    display: 'grid',
    gap: 'var(--space-12)',
    padding: 'var(--space-18)',
    width: '100%',
    marginInline: 'auto',
    minWidth: 0,
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-text)'
  },
  card: {
    display: 'grid',
    gap: 'var(--space-9)',
    minWidth: 0,
    margin: 0,
    padding: 'var(--space-14)',
    borderWidth: 0,
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  copy: { margin: 0, color: 'var(--color-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-8)',
    minWidth: 0
  },
  steps: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-9)',
    listStyle: 'none',
    margin: 0,
    padding: 'var(--space-9)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: 'var(--radius-18)',
    overflowWrap: 'anywhere'
  },
  field: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  input: {
    width: '100%',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    padding: 'var(--space-8)',
    borderRadius: 'var(--radius-9)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  scores: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, calc(var(--space-40) * 4)), 1fr))',
    gap: 'var(--space-8)'
  },
  setRow: {
    display: 'grid',
    minWidth: 0,
    gap: 'var(--space-9)',
    padding: 0,
    margin: 0,
    borderWidth: 0
  },
  stepper: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    minWidth: 0,
    gap: 'var(--space-4)'
  },
  number: {
    width: '100%',
    minWidth: 0,
    textAlign: 'center',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-16)',
    minHeight: 'calc(var(--space-40) + var(--space-4))'
  },
  button: {
    display: 'inline-flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    borderRadius: 'var(--radius-12)',
    borderWidth: 0,
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    textDecoration: 'none',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    },
    ':disabled': { cursor: 'default', opacity: 0.6 }
  },
  primary: { backgroundColor: 'var(--color-green)', color: 'var(--color-bg)', width: '100%' },
  positive: {
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    borderRadius: 'var(--radius-20)',
    padding: 'var(--space-9)',
    margin: 0
  },
  error: { color: 'var(--color-red)', margin: 0, overflowWrap: 'anywhere' },
  pending: {
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)'
  }
});
