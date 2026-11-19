import * as stylex from '@stylexjs/stylex';

export const matchManagementStyles = stylex.create({
  managementCard: {
    gap: 'var(--space-8)',
    padding: 'var(--space-14)',
    borderRadius: 'var(--radius-16)'
  },
  cardTitle: {
    margin: 0,
    fontSize: 'var(--font-size-14)',
    fontWeight: 'var(--font-weight-semibold)',
    lineHeight: 'calc(var(--font-size-14) + var(--space-6))'
  },
  copy: { margin: 0, color: 'var(--color-muted)' },
  actionsTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-8)',
    width: '100%',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    borderWidth: 0,
    borderRadius: 'var(--radius-12)'
  },
  editTrigger: {
    width: '100%',
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-on-green)',
    fontSize: 'var(--font-size-12)',
    fontWeight: 'var(--font-weight-bold)',
    borderWidth: 0,
    borderRadius: 'var(--radius-12)'
  },
  menuPositioner: { zIndex: 10 },
  icon: { width: 'var(--space-20)', height: 'var(--space-20)', flexShrink: 0 },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-12)',
    minHeight: 'calc(var(--space-40) + var(--space-12))',
    paddingInline: 'var(--space-10)',
    paddingBlock: 'var(--space-8)',
    borderRadius: 'var(--radius-8)',
    fontSize: 'var(--font-size-13)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    outline: {
      default: null,
      ':is([data-highlighted])': 'var(--border-width-lg) solid var(--color-green)'
    },
    outlineOffset: 'calc(0px - var(--border-width-lg))'
  },
  transferItem: { backgroundColor: 'var(--color-green-soft)' },
  cancelItem: { color: 'var(--color-red)' },
  section: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    minWidth: 0,
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-12)',
    overflowWrap: 'anywhere'
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-3)'
  },
  button: {
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    minWidth: 'calc(var(--space-40) + var(--space-4))',
    paddingInline: 'var(--space-4)',
    paddingBlock: 'var(--space-2)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'var(--border-width-lg) solid var(--color-green)',
      outlineOffset: 'var(--space-1)'
    }
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--color-bg)',
    opacity: 0.76,
    zIndex: 20
  },
  popup: {
    boxSizing: 'border-box',
    fontFamily: 'var(--font-family-body)',
    position: 'fixed',
    insetInline: 'var(--space-20)',
    insetBlockStart: 'max(var(--space-20), env(safe-area-inset-top))',
    insetBlockEnd: 'max(var(--space-20), env(safe-area-inset-bottom))',
    margin: 'auto',
    height: 'fit-content',
    maxWidth: 'calc(var(--space-40) * 11)',
    maxHeight:
      'calc(100dvh - max(var(--space-20), env(safe-area-inset-top)) - max(var(--space-20), env(safe-area-inset-bottom)))',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    overflowWrap: 'anywhere',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 'var(--space-12)',
    padding: 'var(--space-20)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-18)',
    zIndex: 21
  },
  sheet: {
    '@media (max-width: 36rem)': {
      insetInline: 0,
      insetBlockStart: 'auto',
      insetBlockEnd: 0,
      marginBlock: 0,
      borderEndStartRadius: 0,
      borderEndEndRadius: 0,
      paddingInline: 'var(--space-16)',
      paddingBottom: 'max(var(--space-20), env(safe-area-inset-bottom))'
    }
  },
  dialogTitle: {
    margin: 0,
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--font-size-24)',
    lineHeight: 'var(--font-line-height-snug)',
    fontWeight: 'var(--font-weight-bold)'
  },
  dialogForm: { display: 'grid', gap: 'var(--space-12)', minWidth: 0 },
  dialogActions: { display: 'grid', gap: 'var(--space-8)' },
  fieldLabel: { fontWeight: 'var(--font-weight-semibold)' },
  locked: {
    display: 'grid',
    gap: 'var(--space-8)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-12)',
    backgroundColor: 'var(--color-surface-2)'
  },
  destructive: {
    backgroundColor: 'var(--color-red)',
    color: 'var(--color-bg)'
  },
  menu: {
    padding: 'var(--space-6)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-12)',
    boxShadow: 'var(--shadow-popover)',
    width: 'max-content',
    minWidth: 'calc(var(--space-40) * 5 + var(--space-20) + var(--space-12))',
    maxWidth: 'calc(100vw - var(--space-18) * 2)',
    fontFamily: 'var(--font-family-body)'
  },
  input: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    minHeight: 'calc(var(--space-40) * 2)',
    padding: 'var(--space-12)',
    borderRadius: 'var(--radius-8)',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-text)',
    borderWidth: 'var(--border-width-sm)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)'
  }
});
