/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { StepBadge } from '../src/components/ui/StepBadge';

afterEach(cleanup);

describe('StepBadge', () => {
  it('renders its content inside a span', () => {
    render(createElement(StepBadge, null, '1'));

    const badge = screen.getByText('1');
    expect(badge.tagName).toBe('SPAN');
  });

  it('renders rich children such as text and elements', () => {
    render(createElement(StepBadge, null, createElement('strong', null, '2')));

    expect(screen.getByText('2').tagName).toBe('STRONG');
  });
});
