import * as stylex from '@stylexjs/stylex';

const tap = 'calc(var(--space-40) + var(--space-8))';
const focus = {
  outline: 'var(--border-width-lg) solid var(--color-green)',
  outlineOffset: 'var(--space-2)'
};

export const communityStyles = stylex.create({
  page: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 16)',
    marginInline: 'auto',
    paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))',
    paddingInlineEnd: 'max(var(--space-20), env(safe-area-inset-right))',
    paddingBlockStart: 'max(var(--space-4), env(safe-area-inset-top))',
    paddingBlockEnd: 'var(--space-20)',
    display: 'grid',
    gap: 'var(--space-14)',
    color: 'var(--color-text)',
    overflowWrap: 'anywhere'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-8)'
  },
  headerGroup: { minWidth: 0 },
  srOnly: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    overflow: 'hidden',
    clipPath: 'inset(50%)'
  },
  headerTitle: {
    minWidth: 0,
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    lineHeight: 1.2
  },
  switchTrigger: {
    minHeight: tap,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    fontWeight: 'var(--font-weight-bold)',
    paddingInline: 0,
    overflowWrap: 'anywhere'
  },
  segments: {
    display: 'grid',
    gridAutoColumns: 'minmax(0, 1fr)',
    gridAutoFlow: 'column',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-15)',
    backgroundColor: 'var(--color-surface-2)'
  },
  link: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    minHeight: tap,
    paddingInline: 'var(--space-4)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--radius-12)',
    textDecoration: 'none',
    textAlign: 'center',
    ':focus-visible': focus,
    ':hover': { textDecoration: 'underline' }
  },
  segmentActive: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-green)'
  },
  compact: { minHeight: 'calc(var(--space-40) + var(--space-4))' },
  primary: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    paddingInline: 'var(--space-12)'
  },
  heading: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-18)'
  },
  body: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-14)' },
  stack: { display: 'grid', gap: 'var(--space-8)' },
  card: { display: 'grid', gap: 'var(--space-10)' },
  inline: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', alignItems: 'center' },
  chip: {
    paddingBlock: 'var(--space-4)',
    paddingInline: 'var(--space-10)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)'
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 'var(--space-8)',
    margin: 0
  },
  metric: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontWeight: 'var(--font-weight-bold)'
  },
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-4)' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 'var(--space-8)',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-20))',
    paddingBlock: 'var(--space-6)',
    paddingInline: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface)'
  },
  self: { backgroundColor: 'var(--color-green-soft)' },
  match: {
    minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-8))',
    textAlign: 'start',
    justifyContent: 'space-between'
  },
  gear: { backgroundColor: 'var(--color-surface)', width: tap, flexShrink: 0 }
});
