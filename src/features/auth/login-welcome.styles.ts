import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  page: {
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minHeight: '100dvh',
    width: '100%',
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-20) var(--space-18)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 'var(--space-20)'
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    marginTop: 'var(--space-4)'
  },
  brand: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-bold)'
  },
  subtitle: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    marginBottom: 'var(--space-4)'
  },
  googleMark: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)' },
  promptText: { fontSize: 'var(--font-size-13)' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' }
});
