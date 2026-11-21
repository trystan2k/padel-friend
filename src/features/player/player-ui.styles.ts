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
  topContent: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  header: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
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
  profileCard: { padding: 'var(--space-14)', borderRadius: 'var(--radius-16)' },
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
  muted: { color: 'var(--color-muted)', fontSize: 'var(--font-size-12)', margin: 0 },
  error: { color: 'var(--color-red)', fontSize: 'var(--font-size-12)', margin: 0 },
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
  stack: { display: 'flex', flexDirection: 'column', gap: 'var(--space-9)' },
  availabilityGroups: { display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' },
  availabilityChoices: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-7)',
    marginTop: 'var(--space-9)'
  },
  availabilityChoice: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-3)',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-9)',
    backgroundColor: 'var(--color-surface-2)',
    borderWidth: 'var(--border-width-lg)',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 'var(--radius-10)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    textAlign: 'center',
    cursor: 'pointer',
    ':focus-within': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  availabilityChoiceSelected: {
    backgroundColor: 'var(--color-green-soft)',
    borderColor: 'var(--color-green)',
    color: 'var(--color-green)'
  },
  availabilityChoiceDisabled: { cursor: 'default', opacity: 0.6 },
  availabilityChoiceMark: { display: 'inline-block', width: '1em', textAlign: 'center' },
  availabilityChoiceMarkHidden: { visibility: 'hidden' },
  availabilitySummaryValue: { overflowWrap: 'anywhere', textAlign: 'end' },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  }
});
