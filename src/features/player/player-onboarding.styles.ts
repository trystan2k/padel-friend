import * as stylex from '@stylexjs/stylex';

export const onboardingStyles = stylex.create({
  page: { height: '100dvh' },
  content: {
    gap: 'var(--space-14)',
    overflowY: 'auto',
    scrollPaddingBlock: 'var(--space-20)'
  },
  claimContent: { gap: 'var(--space-12)' },
  progress: { display: 'flex', gap: 'var(--space-6)' },
  segment: {
    flex: 1,
    height: 'var(--space-6)',
    borderRadius: 'var(--space-3)',
    backgroundColor: 'var(--color-surface-2)'
  },
  completeSegment: { backgroundColor: 'var(--color-green)' },
  step: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  label: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  levelCard: { gap: 'var(--space-10)', padding: 'var(--space-15)' },
  valueRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 'var(--space-12)'
  },
  levelValue: {
    fontSize: 'calc(var(--font-size-32) * 1.5)',
    lineHeight: 'calc(var(--font-line-height-tight) + 0.1)',
    fontWeight: 'var(--font-weight-extrabold)',
    fontVariantNumeric: 'tabular-nums'
  },
  estimated: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' },
  estimatedRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-12)'
  },
  locked: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    padding: 'var(--space-4) var(--space-10)',
    borderRadius: 'var(--radius-20)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)'
  },
  track: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: 'calc(var(--space-40) + var(--space-8))'
  },
  rail: (percent: string) => ({
    width: '100%',
    height: 'var(--space-6)',
    borderRadius: 'var(--space-3)',
    boxShadow: 'inset 0 0 0 var(--border-width-sm) var(--color-muted)',
    backgroundImage: `linear-gradient(to right, var(--color-green) ${percent}, var(--color-surface-2) ${percent})`
  }),
  slider: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    border: 0,
    appearance: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    '::-webkit-slider-thumb': {
      appearance: 'none',
      width: 'var(--space-20)',
      height: 'var(--space-20)',
      boxSizing: 'border-box',
      borderRadius: '50%',
      border: 'var(--border-width-lg) solid var(--color-surface)',
      backgroundColor: 'var(--color-green)'
    },
    '::-moz-range-thumb': {
      appearance: 'none',
      width: 'var(--space-20)',
      height: 'var(--space-20)',
      boxSizing: 'border-box',
      borderRadius: '50%',
      border: 'var(--border-width-lg) solid var(--color-surface)',
      backgroundColor: 'var(--color-green)'
    },
    '@media (forced-colors: active)': { appearance: 'auto' },
    ':focus-visible': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    },
    ':disabled': { cursor: 'default', opacity: 0.65 }
  },
  endpoints: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-8)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  choices: {
    display: 'flex',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: 'var(--radius-14)'
  },
  fieldset: { display: 'flex', flexDirection: 'column', gap: 'var(--space-14)' },
  choice: {
    position: 'relative',
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    boxSizing: 'border-box',
    display: 'grid',
    placeItems: 'center',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-11)',
    textAlign: 'center',
    overflowWrap: 'anywhere',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-snug)',
    color: 'var(--color-muted)',
    cursor: 'pointer',
    ':focus-within': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  chosen: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    boxShadow:
      '0 var(--space-1) var(--space-3) color-mix(in srgb, var(--color-text) 14%, transparent)'
  },
  disabled: { cursor: 'default', opacity: 0.65 },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    padding: 'var(--space-12) var(--space-14)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  noticeText: {
    margin: 0,
    fontSize: 'var(--font-size-15)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  noticeIcon: { flexShrink: 0, width: 'var(--space-20)', height: 'var(--space-20)' },
  avatar: {
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 'var(--space-12)'
  },
  avatarBody: {
    minWidth: 0,
    flex: '1 1 calc(var(--space-40) * 4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)'
  },
  actions: { flexShrink: 0, zIndex: 1 },
  avatarPicker: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    padding: 'var(--space-8)',
    border: 'var(--border-width-sm) dashed var(--color-muted)',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    ':focus-within': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  },
  avatarFile: {
    position: 'absolute',
    inset: 0,
    opacity: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer',
    ':disabled': { cursor: 'default' }
  },
  fileName: { overflowWrap: 'anywhere' },
  extraInput: { minHeight: 'calc(var(--space-40) + var(--space-12))' },
  availabilityChoice: {
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    borderRadius: 'var(--radius-14)',
    fontSize: 'var(--font-size-14)',
    ':focus-within': {
      outline: 'var(--focus-width) solid var(--color-focus)',
      outlineOffset: 'var(--focus-offset)'
    }
  }
});
