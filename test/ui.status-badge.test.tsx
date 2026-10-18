/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusBadge } from '../src/components/ui/StatusBadge';
it('renders translated children in span and emphasis remains strong', () => {
  const { rerender } = render(<StatusBadge tone="danger">Translated</StatusBadge>);
  expect(screen.getByText('Translated').tagName).toBe('SPAN');
  rerender(<StatusBadge appearance="emphasis">Label</StatusBadge>);
  expect(screen.getByText('Label').tagName).toBe('STRONG');
});
it('owns notification summary appearance and preserves count span attributes', () => {
  const { rerender } = render(<StatusBadge appearance="summary">3 unread</StatusBadge>);
  expect(screen.getByText('3 unread').tagName).toBe('SPAN');
  expect(screen.getByText('3 unread').className).not.toBe('');
  rerender(
    <StatusBadge appearance="count" aria-hidden="true">
      99+
    </StatusBadge>
  );
  expect(screen.getByText('99+').getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByText('99+').className).toBe('');
});
