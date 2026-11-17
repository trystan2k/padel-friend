import * as stylex from '@stylexjs/stylex';

// Sits after the full-height page frame, so it lives below the fold of the Pencil frame and every
// frame element keeps its design position; the row matches the auth page's width and gutters.
export const styles = stylex.create({
  row: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 12)',
    marginInline: 'auto',
    padding: '0 var(--space-18) var(--space-20)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'var(--color-bg)'
  }
});
