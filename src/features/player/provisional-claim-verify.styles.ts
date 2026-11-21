import * as stylex from '@stylexjs/stylex';

// Claim-verify frames (ewmqC, qGOYb, e8xIw1) draw a six-digit code entry; the app verifies by
// emailed link instead, so the sign-in options sit in a surface card where the code entry would be.
export const styles = stylex.create({
  optionsCard: { gap: 'var(--space-6)' },
  optionsTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  optionsCopy: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    lineHeight: 'var(--font-line-height-comfortable)'
  }
});
