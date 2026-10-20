import * as stylex from '@stylexjs/stylex';

export const rootStyles = stylex.create({
  locale: {
    boxSizing: 'border-box',
    minBlockSize: 'calc(var(--space-40) + var(--space-4))',
    maxInlineSize: '100%',
    inlineSize: 'fit-content'
  }
});
