import * as stylex from '@stylexjs/stylex';

// Frames QqUGZ / pHgfV: 24px insets, brand row (40px tile + wordmark, 44px controls reserved at the
// right), back link, 30px title, 22px rhythm between sections, 16px/1.45 body, 18px section titles.
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
    paddingInline: 'max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-left, 0px))',
    paddingBlockEnd: 'max(calc(var(--space-16) * 2), env(safe-area-inset-bottom, 0px))',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--space-20) + var(--space-2))'
  },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
  // The language and theme chips float over the right of this row (see root.styles homeControls).
  brandRow: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    // 76px: 16px above and below the 44px control row, plus the top safe-area inset.
    minBlockSize: 'calc(var(--space-40) * 2 - var(--space-4) + env(safe-area-inset-top, 0px))',
    paddingBlockStart: 'calc(var(--space-16) + env(safe-area-inset-top, 0px))',
    paddingBlockEnd: 'var(--space-16)',
    paddingInlineEnd: 'calc(var(--space-40) * 2 + var(--space-8) * 2)',
    marginBlockEnd: 'calc(var(--space-4) * -1)'
  },
  mark: {
    position: 'relative',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-11)',
    backgroundColor: 'var(--color-green)'
  },
  markBall: {
    position: 'absolute',
    insetInlineStart: '62.5%',
    insetBlockStart: '14%',
    width: '23.4%',
    height: '23.4%',
    borderRadius: '50%',
    backgroundColor: 'var(--color-lime)'
  },
  markLine: {
    position: 'absolute',
    insetInlineStart: '18.75%',
    insetBlockStart: '70.3%',
    width: '64%',
    height: '4.7%',
    borderRadius: 'var(--space-1)',
    backgroundColor: 'var(--color-on-green)'
  },
  brand: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)'
  },
  back: { alignSelf: 'flex-start', gap: 'var(--space-6)' },
  backIcon: { width: 'var(--space-16)', height: 'var(--space-16)', flexShrink: 0 },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'calc(var(--font-size-29) + var(--space-1))',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1.15,
    overflowWrap: 'anywhere'
  },
  updated: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.45
  },
  notice: {
    margin: 0,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.45
  },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 1.2
  },
  paragraph: {
    margin: 0,
    fontSize: 'var(--font-size-16)',
    lineHeight: 1.45,
    overflowWrap: 'anywhere'
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)'
  },
  item: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: 'var(--space-8)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 1.45,
    overflowWrap: 'anywhere',
    '::before': {
      content: '"•"',
      color: 'var(--color-green)',
      fontWeight: 'var(--font-weight-bold)'
    }
  },
  // Frame "Contact link target": a 44px-tall target for the address.
  email: {
    display: 'inline-flex',
    alignItems: 'center',
    minBlockSize: 'calc(var(--space-40) + var(--space-4))',
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-2)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  }
});
