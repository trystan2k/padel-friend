import * as stylex from '@stylexjs/stylex';

// Clubhouse invitation frames (b7ymtm default, syxBk invalid, wdEqM expired, KZhFq busy): a 56px
// state tile above the 28px heading, an optional help card, and the shared sticky action bar.
const tileSize = 'calc(var(--space-40) + var(--space-16))';

export const styles = stylex.create({
  tileRow: { display: 'flex', paddingBlockStart: 'var(--space-12)' },
  tile: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: tileSize,
    height: tileSize,
    borderRadius: 'var(--radius-12)'
  },
  tileGreen: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green-ink)' },
  tileRed: { backgroundColor: 'var(--color-red-soft)', color: 'var(--color-red)' },
  tileAmber: { backgroundColor: 'var(--color-amber-soft)', color: 'var(--color-amber)' },
  warning: {
    margin: 0,
    padding: 'var(--space-16)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: 'var(--border-width-sm) solid var(--color-muted)',
    borderRadius: 'var(--radius-20)',
    overflowWrap: 'anywhere',
    fontSize: 'var(--font-size-15)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  // Frame KZhFq: the pending button is a flat surface-2 control with muted text, not a dimmed CTA.
  busyButton: {
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    opacity: 1
  },
  helpCard: { gap: 'var(--space-6)' },
  helpTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  helpHint: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-15)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  helpLink: { alignSelf: 'flex-start', gap: 'var(--space-6)' }
});
