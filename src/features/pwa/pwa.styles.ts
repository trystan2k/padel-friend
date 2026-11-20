import * as stylex from '@stylexjs/stylex';

export const pwaStyles = stylex.create({
  install: {
    boxSizing: 'border-box',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    fontFamily: 'var(--font-family-body)'
  },
  installHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)' },
  installGlyph: {
    display: 'grid',
    placeItems: 'center',
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    flexShrink: 0,
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  installTitle: { margin: 0, fontSize: 'var(--font-size-16)' },
  installedTitle: { color: 'var(--color-green-ink)' },
  copy: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere'
  },
  alert: { color: 'var(--color-red)' },
  action: { alignSelf: 'stretch' },
  banner: {
    position: 'fixed',
    insetInline: 'var(--space-16)',
    // Rises above the bottom navigation when the protected shell is mounted.
    insetBlockEnd: {
      default: 'max(var(--space-16), env(safe-area-inset-bottom))',
      [stylex.when.ancestor(':has([data-app-nav])')]:
        'calc(var(--space-6) + var(--space-40) + var(--space-16) + max(var(--space-18), env(safe-area-inset-bottom)) + var(--space-16))'
    },
    zIndex: 30,
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)'
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' }
});
