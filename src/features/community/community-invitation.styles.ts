import * as stylex from '@stylexjs/stylex';

export const invitationStyles = stylex.create({
  page: {
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: 'var(--space-20)'
  },
  header: {
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    display: 'grid',
    placeItems: 'center',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)'
  },
  content: { display: 'grid', gap: 'var(--space-14)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  glyph: {
    display: 'grid',
    placeItems: 'center',
    width: 'calc(var(--space-40) + var(--space-12) * 2)',
    height: 'calc(var(--space-40) + var(--space-12) * 2)',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-green-ink)',
    backgroundColor: 'var(--color-green-soft)',
    fontWeight: 'var(--font-weight-bold)'
  },
  pendingGlyph: { color: 'var(--color-amber)', backgroundColor: 'var(--color-amber-soft)' },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  notice: { padding: 'var(--space-14)', borderRadius: 'var(--radius-14)' },
  actions: {
    display: 'grid',
    gap: 'var(--space-8)',
    paddingBlockStart: 'var(--space-12)',
    borderBlockStart: 'var(--border-width-sm) solid var(--color-hairline)'
  }
});
