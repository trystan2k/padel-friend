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
    padding: 'calc(var(--space-20) + var(--space-4)) var(--space-18) var(--space-20)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-20)'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
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
    fontSize: 'calc(var(--font-size-25) + var(--space-1))',
    fontWeight: 'var(--font-weight-bold)'
  },
  subtitle: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)' },
  note: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  footer: { display: 'flex', justifyContent: 'center', alignItems: 'center' },
  backLink: { minHeight: 'calc(var(--space-40) + var(--space-4))' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' }
});
