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
    maxWidth: '100%',
    marginInline: 'auto'
  },
  loginPage: { gap: 'var(--space-14)' },
  onboardingPage: { gap: 'var(--space-12)' },
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
    color: 'var(--palette-surface)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-7)'
  },
  heroTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-19)',
    fontWeight: 'var(--font-weight-bold)'
  },
  loginHeroTitle: { fontSize: 'var(--font-size-21)' },
  loginHeroCopy: { color: 'var(--color-hero-copy)' },
  heroCopy: { margin: 0, color: 'var(--color-hero-label)', fontSize: 'var(--font-size-12)' },
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-15)',
    padding: 'var(--space-13)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-9)'
  },
  loginCard: { padding: 'var(--space-14)' },
  nameCard: {
    borderRadius: 'var(--radius-12)',
    padding: 'var(--space-8) var(--space-12)',
    gap: 'var(--space-5)'
  },
  profileCard: { padding: 'var(--space-14)', borderRadius: 'var(--radius-16)' },
  loginForm: { gap: 'var(--space-14)' },
  onboardingForm: { gap: 'var(--space-12)' },
  label: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)'
  },
  loginLabel: { fontWeight: 'var(--font-weight-semibold)' },
  loginEmailField: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    paddingInline: 'var(--space-12)',
    backgroundColor: 'var(--color-bg)',
    borderRadius: 'var(--radius-10)'
  },
  loginEmailIcon: {
    width: 'var(--space-16)',
    height: 'var(--space-16)',
    flexShrink: 0,
    color: 'var(--color-muted)'
  },
  loginEmailInput: { flex: 1, minWidth: 0, width: 'auto', paddingInline: 0 },
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
    textTransform: 'uppercase',
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
    justifyContent: 'flex-start',
    paddingInline: 'var(--space-9)',
    gap: 'var(--space-4)',
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
  scale: {
    display: 'flex',
    gap: 'var(--space-4)',
    minWidth: 0,
    paddingBlock: 'var(--space-6)'
  },
  scaleChip: {
    fontFamily: 'var(--font-family-body)',
    minWidth: 0,
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    flex: 1,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-9)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    ':focus-visible': { outline: 'var(--border-width-lg) solid var(--color-green)' }
  },
  scaleSelected: { backgroundColor: 'var(--color-green)', color: 'var(--color-bg)' },
  scaleCaption: {
    display: 'flex',
    justifyContent: 'space-between',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  scaleEndpoint: { fontWeight: 'var(--font-weight-medium)' },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-10)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-11-5)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  dividerRule: { height: 'var(--space-1)', flex: 1, backgroundColor: 'var(--color-hero-divider)' },
  googleMark: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-15)',
    fontWeight: 'var(--font-weight-bold)',
    marginRight: 'var(--space-8)'
  },
  accountPrompt: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-4)',
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)'
  },
  accountAction: {
    fontFamily: 'var(--font-family-body)',
    color: 'var(--color-green)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-bold)',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderStyle: 'none',
    cursor: 'pointer',
    padding: 'var(--space-8)'
  },
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
