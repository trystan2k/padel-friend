import * as stylex from '@stylexjs/stylex';

// Frames wzWLt / FZlHy: 28/24px insets, 14px rhythm, brand tile + wordmark above the title, then
// email, password, forgot link, Log in, "or", Google, sign-up prompt.
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
    paddingBlockStart: 'calc(var(--space-20) + var(--space-8) + env(safe-area-inset-top))',
    paddingInline: 'calc(var(--space-20) + var(--space-4))',
    paddingBlockEnd: 'max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom))',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)'
  },
  brandBlock: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  logo: {
    boxSizing: 'border-box',
    display: 'block',
    width: 'calc(var(--space-40) + var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-20) + var(--space-4))',
    borderRadius: 'var(--radius-20)',
    objectFit: 'contain'
  },
  brand: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  googleMark: {
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)'
  },
  // The 44px text-link targets overflow the text-height rows of the frame; the negative block
  // margin (text row - 44px target) / 2 keeps the surrounding flow at the frame positions.
  targetRow: {
    marginBlock: 'calc((var(--space-18) - var(--space-40) - var(--space-4)) / 2)'
  },
  forgotRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  forgotLink: { position: 'relative' },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  noticeIcon: {
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  noticeCopy: {
    flex: 1,
    margin: 0,
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  promptText: { fontSize: 'var(--font-size-15)', fontWeight: 'var(--font-weight-regular)' }
});
