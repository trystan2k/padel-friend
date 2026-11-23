/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar, TopBarAction } from '../src/components/ui/TopBar';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));

afterEach(cleanup);

describe('TopBar', () => {
  it('renders a centered title, a labelled back link and a trailing action', () => {
    render(
      <TopBar
        title="Match"
        back={{ to: '/matches', label: 'Back to matches' }}
        trailing={<TopBarAction>Share</TopBarAction>}
      />
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Match' })).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Back to matches' });
    expect(back.getAttribute('href')).toBe('/matches');
    expect(back.textContent).toBe('');
    const share = screen.getByRole<HTMLButtonElement>('button', { name: 'Share' });
    expect(share.type).toBe('button');
  });

  it('keeps both side slots when back or trailing content is absent', () => {
    const { container } = render(<TopBar title="Statistics" />);
    const header = container.querySelector('header')!;
    expect(header.children).toHaveLength(3);
    expect(header.children[0]!.childElementCount).toBe(0);
    expect(header.children[2]!.childElementCount).toBe(0);
  });

  it('makes the heading programmatically focusable only when it has an id', () => {
    const { rerender } = render(<TopBar title="Match" />);
    expect(screen.getByRole('heading', { level: 1 }).hasAttribute('tabindex')).toBe(false);
    rerender(<TopBar title="Match" headingId="match-detail-heading" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.id).toBe('match-detail-heading');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });
});
