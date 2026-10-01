/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { TextField } from '../src/components/ui/TextField';

afterEach(cleanup);

function renderField(props: Record<string, unknown> = {}) {
  return render(createElement(TextField, { label: 'Email', ...props }));
}

describe('TextField', () => {
  it('associates the label with the control through htmlFor/id', () => {
    renderField();

    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).not.toBe('');
  });

  it('keeps a caller-provided id stable on label and control', () => {
    renderField({ id: 'email' });

    const input = screen.getByLabelText('Email');
    expect(input.id).toBe('email');
    const label = screen.getByText('Email');
    expect(label.getAttribute('for')).toBe('email');
  });

  it('preserves caller className and style alongside StyleX styles', () => {
    renderField({
      className: 'consumer-field',
      style: { backgroundColor: 'rebeccapurple' }
    });

    const input = screen.getByLabelText('Email');
    expect(input.classList.contains('consumer-field')).toBe(true);
    expect(input.classList.length).toBeGreaterThan(1);
    expect(input.style.backgroundColor).toBe('rebeccapurple');
  });

  it('preserves a caller-provided invalid state without an error message', () => {
    renderField({ id: 'email', 'aria-invalid': 'true' });

    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('renders helper text and wires it through aria-describedby', () => {
    renderField({ id: 'email', helper: 'We never share your email' });

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-describedby')).toBe('email-helper');

    const helper = screen.getByText('We never share your email');
    expect(helper.id).toBe('email-helper');
  });

  it('renders the error with role alert, marks the control invalid and wires both ids', () => {
    renderField({ id: 'email', error: 'Email is required' });

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Email is required');
    expect(error.id).toBe('email-error');
  });

  it('leaves aria-invalid unset when there is no error', () => {
    renderField({ id: 'email', helper: 'Optional field' });

    const input = screen.getByLabelText('Email');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.getAttribute('aria-describedby')).toBe('email-helper');
  });

  it('prepends a caller-provided aria-describedby before the generated ids', () => {
    renderField({
      id: 'email',
      helper: 'Hint',
      error: 'Bad format',
      'aria-describedby': 'external-hint'
    });

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-describedby')).toBe('external-hint email-helper email-error');
  });

  it('omits aria-describedby when no helper, error or caller description exists', () => {
    renderField({ id: 'email' });

    const input = screen.getByLabelText('Email');
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('passes native attributes like required, autoComplete and type through', () => {
    renderField({ id: 'email', required: true, autoComplete: 'email', type: 'email' });

    const input = screen.getByLabelText('Email');
    expect(input.hasAttribute('required')).toBe(true);
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(input.getAttribute('type')).toBe('email');
  });

  it('disables the control when disabled is set', () => {
    renderField({ id: 'email', disabled: true });

    const input = screen.getByLabelText('Email');
    expect(input.hasAttribute('disabled')).toBe(true);
  });
});
