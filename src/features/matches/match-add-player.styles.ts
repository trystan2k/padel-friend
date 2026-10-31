import * as stylex from '@stylexjs/stylex';

export const addPlayerStyles = stylex.create({
  popup: { gap: 'var(--space-10)' },
  heading: { display: 'grid', gap: 'var(--space-3)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  copy: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  form: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    minWidth: 0,
    gap: 'var(--space-10)'
  },
  levelGroup: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  levelHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  levelLabel: {
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  levelValue: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)'
  },
  levelUnset: { color: 'var(--color-muted)', fontSize: 'var(--font-size-13)' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' },
  note: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    paddingBlock: 'var(--space-8)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)'
  },
  noteIcon: { width: 'var(--space-15)', height: 'var(--space-15)', flexShrink: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' },
  action: { flexGrow: 1, flexBasis: 0, minWidth: 'calc(var(--space-40) * 2)' },
  status: { margin: 0, minHeight: 0, fontSize: 'var(--font-size-13)' },
  success: { color: 'var(--color-green)' }
});
