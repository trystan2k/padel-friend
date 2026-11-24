import * as stylex from '@stylexjs/stylex';

// The preferences page pads its whole panel by 20; frame y8ErQ puts the shared top bar flush with the
// page edge (8 bar inset), so the bar cancels that padding instead of doubling it.
export const preferenceBarStyles = stylex.create({
  bleed: {
    marginInline: 'calc(var(--space-20) * -1)',
    marginBlockStart: 'calc(var(--space-20) * -1)'
  }
});
