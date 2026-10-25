import * as stylex from '@stylexjs/stylex';

export const matchDetailShellStyles = stylex.create({
  resultEntryTitle: { lineHeight: 'calc(var(--space-20) + var(--space-6))' },
  resultParticipation: { gap: 'var(--space-6)' },
  resultCountLine: { lineHeight: 'calc(var(--space-12) + var(--space-5))' },
  page: {
    gap: 'var(--space-12)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'calc(var(--font-size-12) + var(--space-5))'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
    paddingRight: 'calc(var(--space-40) * 2 + var(--space-8) * 3)'
  },
  heading: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  subtitle: {
    margin: 0,
    color: 'var(--color-muted)',
    lineHeight: 'calc(var(--font-size-12) + var(--space-3))'
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-4))',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-12)',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  icon: { width: 'var(--space-20)', height: 'var(--space-20)', flexShrink: 0 },
  groups: { display: 'grid', gap: 'var(--space-10)', minWidth: 0 },
  card: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0
  },
  title: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'calc(var(--font-size-14) + var(--space-6))'
  },
  venue: {
    fontFamily: 'var(--font-family-heading)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-18)',
    lineHeight: 'calc(var(--font-size-18) + var(--space-4))'
  },
  copy: { margin: 0, color: 'var(--color-muted)' },
  participants: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'calc(var(--font-size-12) + var(--space-3))'
  },
  accepted: {
    margin: 0,
    fontWeight: 'var(--font-weight-bold)',
    lineHeight: 'calc(var(--font-size-12) + var(--space-3))'
  },
  image: {
    height: 'calc(var(--space-40) * 3 + var(--space-8))',
    aspectRatio: 'auto',
    borderRadius: 'var(--radius-12)',
    minHeight: 0
  },
  cancelledBadge: {
    display: 'flex',
    justifyContent: 'flex-start',
    minHeight: 'calc(var(--space-20) + var(--space-4))'
  },
  maps: { paddingInline: 0, textDecoration: 'none', fontSize: 'var(--font-size-13)' },
  share: {
    textTransform: 'uppercase',
    borderWidth: 0,
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-12)',
    borderRadius: 'var(--radius-12)'
  },
  shareField: { display: 'grid', gap: 'var(--space-4)' },
  input: {
    width: '100%',
    minWidth: 0,
    resize: 'none',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    paddingInline: 'var(--space-12)',
    fontSize: 'var(--font-size-14)'
  },
  banner: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-muted)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'calc(var(--font-size-12) + var(--space-5))'
  },
  positive: { backgroundColor: 'var(--color-green-soft)', color: 'var(--color-green)' },
  positiveAccent: { color: 'var(--color-green)' },
  bannerHeading: { display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }
});
