import * as stylex from '@stylexjs/stylex';

// Pencil frames: 18px rails, 32px major gap, 16px hero gap, 8px CTA inset / 12px row gap,
// 14px card padding / 16px radius / 40px icon tile, 24px footer top inset, 32px bottom inset.
// Space tokens stop at 20 and 40, so larger steps are composed from them.
const target = 'calc(var(--space-40) + var(--space-4))';

const focusRing = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
} as const;

export const styles = stylex.create({
  page: {
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minHeight: '100dvh',
    width: '100%',
    boxSizing: 'border-box',
    // Same bounded column as the other public pages; centered on desktop.
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    // Top inset clears the language/theme controls that float above the page.
    padding: 'calc(var(--space-40) + var(--space-16)) var(--space-18) calc(var(--space-16) * 2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--space-16) * 2)'
  },
  brand: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    letterSpacing: 'var(--font-letter-spacing-1-5)'
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--space-16) * 2)',
    minWidth: 0
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-16)',
    minWidth: 0
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-32)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 1.25,
    overflowWrap: 'break-word'
  },
  description: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'break-word'
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
    marginTop: 'var(--space-8)'
  },
  cta: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minWidth: 0,
    // 49px designed row, never below the 44px target.
    minHeight: 'calc(var(--space-40) + var(--space-9))',
    paddingInline: 'var(--space-12)',
    borderStyle: 'solid',
    borderWidth: 'var(--border-width-sm)',
    borderRadius: 'var(--radius-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    textDecoration: 'none',
    overflowWrap: 'break-word',
    ':focus-visible': focusRing
  },
  ctaPrimary: {
    backgroundColor: 'var(--color-green)',
    borderColor: 'var(--color-green)',
    color: 'var(--color-bg)'
  },
  ctaSecondary: {
    backgroundColor: 'var(--color-surface)',
    borderColor: 'var(--color-line)',
    color: 'var(--color-text)'
  },
  features: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)'
  },
  card: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    minWidth: 0,
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  iconTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)'
  },
  icon: {
    width: 'var(--space-20)',
    height: 'var(--space-20)'
  },
  cardTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-16)',
    fontWeight: 'var(--font-weight-bold)',
    overflowWrap: 'break-word'
  },
  cardDescription: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'break-word'
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--space-12) * 2)',
    minWidth: 0,
    paddingTop: 'calc(var(--space-12) * 2)',
    borderTopStyle: 'solid',
    borderTopWidth: 'var(--border-width-sm)',
    borderTopColor: 'var(--color-line)'
  },
  contact: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  legal: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  // The 44px anchor overflows the 15px Pencil text row; the negative block margin
  // (15px row - 44px target) / 2 keeps the surrounding flow at the Pencil positions.
  footerLink: {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    minHeight: target,
    marginBlock: 'calc((var(--space-15) - var(--space-40) - var(--space-4)) / 2)',
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-bold)',
    textDecoration: 'none',
    overflowWrap: 'anywhere',
    ':focus-visible': focusRing
  },
  footerText: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'break-word'
  }
});
