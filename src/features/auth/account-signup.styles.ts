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
  emailField: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)' },
  label: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-regular)'
  },
  emailControl: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    paddingInline: 'var(--space-12)',
    minHeight: 'var(--space-40)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-bg)',
    '::after': {
      content: '""',
      position: 'absolute',
      insetInline: 0,
      top: '100%',
      height: 'var(--space-4)'
    },
    ':focus-within': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  mailIcon: {
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    flexShrink: 0,
    color: 'var(--color-muted)'
  },
  emailInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    minHeight: 'var(--space-40)',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-13)',
    '::placeholder': { color: 'var(--color-muted)', opacity: 1 },
    ':focus-visible': { outline: 'none' }
  },
  passwordFrame: {
    position: 'relative',
    height: 'var(--space-40)',
    marginTop: 'var(--space-3)',
    marginBottom: 'var(--space-2)',
    borderRadius: 'var(--radius-10)',
    backgroundColor: 'var(--color-bg)'
  },
  passwordControl: {
    position: 'absolute',
    inset: 0,
    height: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    backgroundColor: 'transparent',
    borderWidth: 0
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
