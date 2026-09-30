/**
 * @vitest-environment jsdom
 */
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Button } from '../src/components/ui/Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders a native button with type button by default', () => {
    render(createElement(Button, null, 'Start'));

    const button = screen.getByRole('button', { name: 'Start' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('passes the type prop through for submit buttons', () => {
    render(createElement(Button, { type: 'submit' }, 'Sign in'));

    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('type')).toBe('submit');
  });

  it('preserves caller className and style alongside StyleX styles', () => {
    render(
      createElement(
        Button,
        { className: 'consumer-button', style: { backgroundColor: 'rebeccapurple' } },
        'Custom'
      )
    );

    const button = screen.getByRole('button', { name: 'Custom' });
    expect(button.classList.contains('consumer-button')).toBe(true);
    expect(button.classList.length).toBeGreaterThan(1);
    expect(button.style.backgroundColor).toBe('rebeccapurple');
  });

  it('renders the primary and secondary variants as buttons', () => {
    render(
      createElement(
        'div',
        null,
        createElement(Button, { variant: 'primary' }, 'Primary'),
        createElement(Button, { variant: 'secondary' }, 'Secondary')
      )
    );

    expect(screen.getByRole('button', { name: 'Primary' }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Secondary' }).tagName).toBe('BUTTON');
  });

  it('is keyboard focusable while enabled and fires the click handler', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(createElement(Button, { onClick }, 'Save'));

    const button = screen.getByRole('button', { name: 'Save' });
    await user.tab();
    expect(document.activeElement).toBe(button);

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rejects clicks while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(createElement(Button, { disabled: true, onClick }, 'Save'));

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes the busy state and rejects clicks while busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(createElement(Button, { busy: true, onClick }, 'Save'));

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('drops aria-busy when not busy', () => {
    render(createElement(Button, null, 'Save'));

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('aria-busy')).toBe(false);
  });
});
