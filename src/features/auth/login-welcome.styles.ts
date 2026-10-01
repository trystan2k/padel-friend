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
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)'
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
    gap: 'var(--space-14)'
  },
  googleMark: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    marginTop: 'calc(-1 * var(--space-2))'
  },
  forgotRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  forgotLink: {
    position: 'relative',
    '::before': {
      content: '""',
      position: 'absolute',
      display: 'block',
      insetBlockStart: '50%',
      insetInlineEnd: 0,
      width: '100%',
      minWidth: 'calc(var(--space-40) + var(--space-4))',
      height: 'calc(var(--space-40) + var(--space-4))',
      transform: 'translateY(-50%)'
    }
  },
  notice: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)'
  },
  noticeTitle: {
    margin: 0,
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  noticeCopy: {
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)'
  },
  promptText: { fontSize: 'var(--font-size-13)' },
  error: { margin: 0, color: 'var(--color-red)', fontSize: 'var(--font-size-12)' }
});
