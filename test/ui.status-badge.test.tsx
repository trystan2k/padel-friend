/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusBadge } from '../src/components/ui/StatusBadge';
import type { StatusBadgeTone } from '../src/components/ui/StatusBadge';
const tones: StatusBadgeTone[] = ['positive', 'neutral', 'muted', 'danger', 'guest'];
it('renders each presentation tone', () => {
  for (const tone of tones) {
    const { unmount } = render(<StatusBadge tone={tone}>{tone}</StatusBadge>);
    expect(screen.getByText(tone).tagName).toBe('SPAN');
    expect(screen.getByText(tone).className).not.toBe('');
    unmount();
  }
  const { container } = render(<StatusBadge>default</StatusBadge>);
  expect(container.querySelector('span')?.className).not.toBe('');
});
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
