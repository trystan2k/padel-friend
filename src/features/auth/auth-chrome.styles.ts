import * as stylex from '@stylexjs/stylex';

// Clubhouse auth frames (wzWLt, EGb2g, ieoni, FZlHy, ZthyR): 28px extrabold title, 16px muted body,
// 56px top bar with a 48px back target, and a white sticky action bar (12/20/24 inset) holding the
// CTAs. The pen's 44px status bar is device chrome, not app UI: it is never rendered here.
const backSize = 'calc(var(--space-40) + var(--space-8))';

export const chromeStyles = stylex.create({
  page: {
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family-body)',
    minHeight: '100dvh',
    width: '100%',
    boxSizing: 'border-box',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
  topBar: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    minHeight: 'calc(var(--space-40) + var(--space-16))',
    paddingInline: 'var(--space-8)',
    paddingBlockStart: 'env(safe-area-inset-top)'
  },
  // Frame top bar: 48px back slot, centered title, 72px action slot (empty on these screens).
  backSlot: { flexShrink: 0, width: backSize, height: backSize },
  back: {
    flexShrink: 0,
    boxSizing: 'border-box',
    width: backSize,
    height: backSize,
    justifyContent: 'center',
    borderRadius: 'var(--radius-14)',
    color: 'var(--color-text)'
  },
  actionSlot: {
    flexShrink: 0,
    width: 'calc(var(--space-40) + var(--space-20) + var(--space-12))'
  },
  barTitle: {
    flex: 1,
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-17)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center'
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  },
  form: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-16)',
    padding: 'var(--space-4) var(--space-20) var(--space-20)'
  },
  // D1 frames (invitation, claim password, claim verify) stack their blocks 14px apart, not 16px.
  contentTight: { gap: 'var(--space-14)' },
  // The heading only takes programmatic focus (screen-reader announcement), it is not a control.
  headingFocus: { outline: 'none' },
  // Frame page heading: 6px between the 28px title and its 16px intro.
  heading: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-28)',
    fontWeight: 'var(--font-weight-extrabold)',
    lineHeight: 'var(--font-line-height-snug)',
    overflowWrap: 'anywhere'
  },
  body: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-16)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  meta: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  error: {
    margin: 0,
    color: 'var(--color-red)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)'
  },
  actionBar: {
    position: 'sticky',
    insetBlockEnd: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-8)',
    padding:
      'var(--space-12) var(--space-20) max(calc(var(--space-20) + var(--space-4)), env(safe-area-inset-bottom))',
    backgroundColor: 'var(--color-surface)',
    borderBlockStartWidth: 'var(--border-width-sm)',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-hairline)'
  },
  barNote: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'var(--font-line-height-comfortable)',
    textAlign: 'center'
  },
  barLink: {
    justifyContent: 'center',
    width: '100%',
    minHeight: 'calc(var(--space-40) + var(--space-8))',
    borderRadius: 'var(--radius-14)',
    fontSize: 'var(--font-size-16)'
  }
});
