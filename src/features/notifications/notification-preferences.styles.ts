import * as stylex from '@stylexjs/stylex';

export const preferenceStyles = stylex.create({
  page: {
    minHeight: '100%',
    padding: 'var(--space-20)',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-family-body)'
  },
  panel: {
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)'
  },
  context: { margin: 0, color: 'var(--color-muted)', fontSize: 'var(--font-size-12)' },
  group: {
    boxSizing: 'border-box',
    width: '100%',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-hairline)',
    borderRadius: 'var(--radius-18)',
    padding: 'var(--space-16)',
    minInlineSize: 0,
    margin: 0,
    backgroundColor: 'var(--color-surface)'
  },
  // A floated legend leaves the border line, so it never notches the card border.
  legend: {
    float: 'inline-start',
    width: '100%',
    padding: 0,
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    minHeight: 'calc(var(--space-40) + var(--space-20) + var(--space-8))',
    paddingBlock: 'var(--space-4)',
    borderBlockEndWidth: 'var(--border-width-sm)',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-line)'
  },
  copy: {
    display: 'grid',
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontWeight: 'var(--font-weight-semibold)'
  },
  helper: {
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'normal'
  },
  switch: {
    boxSizing: 'border-box',
    width: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    height: 'calc(var(--space-40) + var(--space-12))',
    display: 'inline-flex',
    alignItems: 'center',
    padding: 'var(--space-2)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'transparent',
    position: 'relative',
    '::before': {
      content: '""',
      position: 'absolute',
      insetInline: 0,
      height: 'calc(var(--space-20) + var(--space-4))',
      borderRadius: 'var(--radius-20)',
      backgroundColor: 'var(--color-muted)'
    },
    ':is([data-disabled])': { opacity: 0.65 },
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-2)'
    }
  },
  checked: { '::before': { backgroundColor: 'var(--color-green)' } },
  thumb: {
    width: 'var(--space-20)',
    height: 'var(--space-20)',
    borderRadius: 'var(--radius-20)',
    backgroundColor: 'var(--color-surface)',
    transform: 'translateX(0)'
  },
  thumbChecked: { transform: 'translateX(calc(var(--space-20) + var(--space-2)))' },
  always: {
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-14)',
    backgroundColor: 'var(--color-green-soft)',
    borderInlineStartWidth: 'var(--border-width-lg)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--color-green)'
  },
  alwaysTitle: { margin: 0, fontSize: 'var(--font-size-14)' },
  alwaysCopy: { marginBlock: 'var(--space-4)', fontSize: 'var(--font-size-12)' },
  alwaysBadge: {
    fontSize: 'var(--font-size-12)',
    color: 'var(--color-green-ink)',
    fontWeight: 'var(--font-weight-bold)'
  },
  device: {
    boxSizing: 'border-box',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)',
    backgroundColor: 'var(--color-surface)'
  },
  deviceHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-12)' },
  deviceGlyph: {
    width: 'var(--space-40)',
    height: 'var(--space-40)',
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-green-soft)',
    color: 'var(--color-green-ink)'
  },
  deviceTitle: { margin: 0, fontSize: 'var(--font-size-16)' },
  deviceTitleOk: { color: 'var(--color-green-ink)' },
  deviceTitleFailed: { color: 'var(--color-red)', backgroundColor: 'var(--color-red-soft)' },
  deviceCopy: {
    display: 'block',
    margin: 0,
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-line-height-body)',
    overflowWrap: 'anywhere',
    ':empty': { display: 'none' }
  },
  deviceAlert: { color: 'var(--color-red)' },
  deviceFallback: { color: 'var(--color-green)' },
  deviceAction: { alignSelf: 'stretch' }
});
