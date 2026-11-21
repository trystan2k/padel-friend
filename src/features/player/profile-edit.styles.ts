import * as stylex from '@stylexjs/stylex';

// Frames VpcMM / xlgw8 (profile edit): 56px top bar with the 48px back target and a centered 17/700
// title, 28/800 heading, 56px avatar row with a green change-photo link, 52px fields, 18/800 group
// titles, 44px availability chips, segmented theme control and a sticky Cancel / Save bar.
// Tokens only; every target is at least 44px.
const touchTarget = 'calc(var(--space-40) + var(--space-4))';
const focusRing = {
  outline: 'var(--focus-width) solid var(--color-focus)',
  outlineOffset: 'var(--focus-offset)'
} as const;

export const profileEdit = stylex.create({
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    minHeight: '100dvh',
    marginInline: 'auto',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    overflowWrap: 'anywhere'
  },
  topBar: {
    display: 'grid',
    gridTemplateColumns:
      'calc(var(--space-40) + var(--space-8)) minmax(0, 1fr) calc(var(--space-40) + var(--space-20) + var(--space-12))',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingInline: 'var(--space-8)'
  },
  back: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'calc(var(--space-40) + var(--space-8))',
    height: 'calc(var(--space-40) + var(--space-8))',
    padding: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'transparent',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': focusRing
  },
  backIcon: {
    width: 'calc(var(--space-20) + var(--space-4))',
    height: 'calc(var(--space-20) + var(--space-4))'
  },
  navTitle: {
    margin: 0,
    textAlign: 'center',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'var(--font-line-height-tight)'
  },
  form: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-14)',
    flex: 1,
    minWidth: 0,
    padding: 'var(--space-4) var(--space-20) var(--space-20)'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)'
  },
  group: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
  groupTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  subgroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0
  },
  legend: {
    padding: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    marginBlockEnd: 'var(--space-6)'
  },
  label: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    paddingInline: 'var(--space-12)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderWidth: 'var(--border-width-md)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-16)',
    ':focus-visible': focusRing
  },
  textarea: {
    minHeight: 'calc(var(--space-40) * 2)',
    paddingBlock: 'var(--space-12)',
    resize: 'vertical'
  },
  fieldError: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  actions: {
    position: 'sticky',
    insetBlockEnd: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    padding:
      'var(--space-12) var(--space-20) max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom, 0px))',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)',
    backgroundColor: 'var(--color-surface)'
  },
  cancel: { width: 'calc(var(--space-40) * 2 + var(--space-20) + var(--space-12))', flexShrink: 0 },
  save: { flex: 1, minWidth: 0 },
  touch: { minWidth: touchTarget }
});

// Avatar row (frame "Avatar and action"): 56px initials disc beside the Change photo link.
export const avatarRow = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)', flexWrap: 'wrap' },
  avatar: {
    boxSizing: 'border-box',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-16))',
    height: 'calc(var(--space-40) + var(--space-16))',
    borderRadius: 'var(--radius-36)',
    objectFit: 'cover',
    backgroundColor: 'var(--color-lime)',
    color: 'var(--palette-text)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-extrabold)'
  },
  body: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0, flex: 1 },
  change: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 'var(--space-6)',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  icon: { width: 'var(--space-16)', height: 'var(--space-16)', flexShrink: 0 },
  file: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
    ':disabled': { cursor: 'default' }
  },
  help: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  error: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)'
  }
});

// Availability chips (frame "Days of the week" / "Times of day"): equal-width pills, 44px tall,
// green-soft with a green hairline when chosen.
export const chips = stylex.create({
  // Wraps below the 7 x 44px the day row needs (narrow phones); the frame width keeps one row.
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-6)',
    paddingInline: 'var(--space-1)'
  },
  chip: {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'grid',
    placeItems: 'center',
    flex: '1 1 0',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-muted)',
    borderRadius: 'var(--radius-36)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    cursor: 'pointer',
    ':focus-within': focusRing
  },
  chosen: {
    backgroundColor: 'var(--color-green-soft)',
    borderColor: 'var(--color-green)',
    color: 'var(--color-green-ink)'
  },
  disabled: { cursor: 'default', opacity: 0.6 },
  input: { position: 'absolute', opacity: 0, width: 'var(--space-1)', height: 'var(--space-1)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  }
});
