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
    // Top inset clears the language/theme controls that float above the page.
    padding: 'calc(var(--space-40) + var(--space-20)) var(--space-18) var(--space-20)',
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
  updated: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  notice: {
    margin: 0,
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.5
  },
  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)'
  },
  paragraph: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.5,
    overflowWrap: 'anywhere'
  },
  list: {
    margin: 0,
    paddingInlineStart: 'var(--space-18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 1.5,
    overflowWrap: 'anywhere'
  },
  email: {
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'underline',
    textUnderlineOffset: 'var(--space-2)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  footer: { display: 'flex', justifyContent: 'center', alignItems: 'center' }
});
