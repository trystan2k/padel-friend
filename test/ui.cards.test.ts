/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { HeroCard } from '../src/components/ui/HeroCard';
import { SurfaceCard } from '../src/components/ui/SurfaceCard';

afterEach(cleanup);

describe('SurfaceCard', () => {
  it('renders children inside a div container', () => {
    render(createElement(SurfaceCard, null, createElement('h1', null, 'Welcome')));

    const heading = screen.getByRole('heading', { name: 'Welcome' });
    expect(heading.closest('div')).not.toBeNull();
  });

  it('forwards native div props like aria labels', () => {
    render(createElement(SurfaceCard, { 'aria-label': 'Player card' }, 'Body'));

    expect(screen.getByLabelText('Player card').textContent).toBe('Body');
  });
});

describe('HeroCard', () => {
  it('renders children inside a div container', () => {
    render(createElement(HeroCard, null, createElement('p', null, 'Track your matches')));

    expect(screen.getByText('Track your matches').tagName).toBe('P');
  });

  it('forwards native div props like aria labels', () => {
    render(createElement(HeroCard, { 'aria-label': 'Hero' }, 'Body'));

    const card = screen.getByLabelText('Hero');
    expect(card.getAttribute('aria-label')).toBe('Hero');
    expect(card.textContent).toBe('Body');
  });
});
