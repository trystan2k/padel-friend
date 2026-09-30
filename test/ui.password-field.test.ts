/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { PasswordField } from '../src/components/ui/PasswordField';

afterEach(cleanup);

describe('PasswordField', () => {
  it('renders a masked input associated with its label', () => {
    render(createElement(PasswordField, { label: 'Password', autoComplete: 'current-password' }));

    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.id).not.toBe('');
  });

  it('keeps autoComplete current-password for sign-in fields', () => {
    render(createElement(PasswordField, { label: 'Password', autoComplete: 'current-password' }));

    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
  });

  it('keeps autoComplete new-password for sign-up fields', () => {
    render(createElement(PasswordField, { label: 'Password', autoComplete: 'new-password' }));

    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
  });

  it('inherits TextField error semantics through the wrapper', () => {
    render(
      createElement(PasswordField, {
        label: 'Password',
        autoComplete: 'new-password',
        error: 'At least 8 characters'
      })
    );

    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('At least 8 characters');
  });
});
