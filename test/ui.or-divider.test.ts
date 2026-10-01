/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { OrDivider } from '../src/components/ui/OrDivider';

afterEach(cleanup);

describe('OrDivider', () => {
  it('renders the visible label between two separators', () => {
    const { container } = render(createElement(OrDivider, { label: 'or' }));

    expect(screen.getByText('or').tagName).toBe('SPAN');
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps the decorative separators out of the accessibility tree', () => {
    render(createElement(OrDivider, { label: 'or continue with' }));

    expect(screen.queryByRole('separator')).toBeNull();
  });
});
