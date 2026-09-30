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
    padding: 'var(--space-18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)'
  },
  hero: {
    marginTop: 'calc(-1 * var(--space-2))',
    color: 'var(--color-on-hero)'
  },
  card: { gap: 'var(--space-9)' },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  subtitle: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  heroTitle: {
    margin: 0,
    color: 'var(--color-on-hero)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-21)',
    fontWeight: 'var(--font-weight-bold)'
  },
  heroCopy: { margin: 0, color: 'var(--color-hero-copy)', fontSize: 'var(--font-size-12)' },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    marginTop: 'var(--space-3)'
  },
  submit: { fontSize: 'var(--font-size-13)', marginTop: 'var(--space-2)' },
  note: {
    margin: 'var(--space-2) 0 0',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  prompt: { marginTop: 'var(--space-2)' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' }
});
