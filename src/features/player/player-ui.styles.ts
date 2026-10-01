import * as stylex from '@stylexjs/stylex';

export const ui = stylex.create({
  page: {
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minHeight: '100vh',
    padding: 'var(--space-18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-10)',
    paddingBottom: 'var(--space-14)',
    width: '100%',
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto'
  },
  onboardingPage: { gap: 'var(--space-10)' },
  profilePage: { gap: 'var(--space-8)' },
  topContent: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  profileTop: { display: 'flex', flexDirection: 'column', gap: 'var(--space-13)' },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-12)'
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)'
  },
  subtitle: {
    margin: 0,
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-muted)'
  },
  step: {
    alignSelf: 'flex-start',
    borderRadius: 'var(--radius-20)',
    padding: 'var(--space-5) var(--space-9)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  hero: {
    backgroundColor: 'var(--color-green-deep)',
    borderRadius: 'var(--radius-18)',
    padding: 'var(--space-17)',
    color: 'var(--color-on-hero)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-7)'
  },
  heroTitle: {
    margin: 0,
    color: 'var(--color-on-hero)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-19)',
    fontWeight: 'var(--font-weight-bold)'
  },
  heroCopy: { margin: 0, color: 'var(--color-hero-label)', fontSize: 'var(--font-size-12)' },
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-15)',
    padding: 'var(--space-13)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-9)'
  },
  onboardingCard: { gap: 'var(--space-9)' },
  onboardingLevelHeading: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-9)'
  },
  onboardingLevelValue: { fontSize: 'var(--font-size-29)' },
  onboardingExtras: { marginTop: 'calc(var(--space-40) * 3)' },
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    minHeight: 'calc(var(--space-40) + var(--space-4))'
  },
  sliderTrack: {
    position: 'relative',
    width: '100%',
    height: 'var(--space-20)',
    display: 'flex',
    alignItems: 'center',
    borderRadius: 'var(--radius-7)',
    backgroundColor: 'var(--color-surface-2)'
  },
  sliderFill: {
    height: 'var(--space-14)',
    borderRadius: 'var(--radius-7)',
    backgroundColor: 'var(--color-green)'
  },
  sliderInput: {
    position: 'absolute',
    top: 'calc(-1 * var(--space-12))',
    left: 0,
    width: '100%',
    height: 'calc(var(--space-40) + var(--space-4))',
    margin: 0,
    appearance: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    '::-webkit-slider-thumb': {
      appearance: 'none',
      width: 'var(--space-20)',
      height: 'var(--space-20)',
      borderRadius: 'var(--radius-20)',
      borderWidth: 'var(--border-width-lg)',
      borderStyle: 'solid',
      borderColor: 'var(--color-bg)',
      backgroundColor: 'var(--color-green)'
    },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  sliderLabels: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  sliderCurrent: {
    position: 'absolute',
    transform: 'translateX(-50%)',
    color: 'var(--color-green)',
    fontWeight: 'var(--font-weight-bold)'
  },
  onboardingChoices: { marginTop: 0 },
  profileCard: { padding: 'var(--space-14)', borderRadius: 'var(--radius-16)' },
  onboardingForm: { gap: 'var(--space-12)', marginTop: 'var(--space-2)' },
  label: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)'
  },
  input: {
    fontFamily: 'var(--font-family-body)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    backgroundColor: 'var(--color-bg)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-10)',
    padding: 'var(--space-12)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-13)',
    '::placeholder': { color: 'var(--color-muted)', opacity: 1 },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  textarea: { resize: 'vertical' },
  button: {
    fontFamily: 'var(--font-family-body)',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-12)',
    padding: 'var(--space-13)',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-bg)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    },
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  secondaryButton: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderWidth: 0,
    fontWeight: 'var(--font-weight-semibold)',
    padding: 'var(--space-12)'
  },
  headerAction: {
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    flexShrink: 0,
    padding: 0,
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)'
  },
  headerActionIcon: { width: 'var(--space-16)', height: 'var(--space-16)' },
  fieldset: { borderWidth: 0, borderStyle: 'none', margin: 0, minWidth: 0 },
  bareFieldset: { padding: 0 },
  choices: { display: 'flex', gap: 'var(--space-7)', marginTop: 'var(--space-9)' },
  choice: {
    display: 'flex',
    flex: 1,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-9)',
    gap: 'var(--space-2)',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: 'var(--radius-10)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    ':focus-within': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  selected: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  radio: { position: 'absolute', opacity: 0, width: 'var(--space-1)', height: 'var(--space-1)' },
  scaleCaption: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  onboardingScaleCaption: { width: 'calc(80% + var(--space-3))' },
  scaleEndpoint: { fontWeight: 'var(--font-weight-medium)' },
  identityHero: { padding: 'var(--space-15)', gap: 'var(--space-12)' },
  heroSide: { color: 'var(--color-hero-accent)' },
  heroJoined: { color: 'var(--color-hero-muted)' },
  levelLabel: {
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-muted)'
  },
  levelMetric: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-32)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)'
  },
  levelHeader: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  levelTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-8)'
  },
  progressTrack: {
    width: '100%',
    height: 'var(--space-14)',
    borderRadius: 'var(--radius-7)',
    backgroundColor: 'var(--color-surface-2)',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--color-green)',
    borderRadius: 'var(--radius-7)'
  },
  stateCard: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-12)',
    padding: 'var(--space-9) var(--space-10)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-9)'
  },
  stateCopy: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  stateIcon: { fontSize: 'var(--font-size-17)', color: 'var(--color-green)' },
  stateErrorIcon: { color: 'var(--color-red)' },
  stateTitle: {
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    margin: 0
  },
  stateDescription: { fontSize: 'var(--font-size-12)', color: 'var(--color-muted)', margin: 0 },
  level: {
    color: 'var(--color-green)',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-29)',
    fontWeight: 'var(--font-weight-bold)'
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-8)'
  },
  muted: { color: 'var(--color-muted)', fontSize: 'var(--font-size-12)', margin: 0 },
  error: { color: 'var(--color-red)', fontSize: 'var(--font-size-12)', margin: 0 },
  identity: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)' },
  avatar: {
    width: 'calc(var(--space-40) + var(--space-16))',
    height: 'calc(var(--space-40) + var(--space-16))',
    borderRadius: 'var(--radius-36)',
    objectFit: 'cover',
    backgroundColor: 'var(--color-hero-avatar)',
    color: 'var(--color-green-deep)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    fontWeight: 'var(--font-weight-bold)'
  },
  name: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)',
    fontWeight: 'var(--font-weight-bold)'
  },
  stack: { display: 'flex', flexDirection: 'column', gap: 'var(--space-9)' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  }
});
