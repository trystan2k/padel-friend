/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RosterRow } from '../src/components/ui/RosterRow';
it('renders name before composable content and request header identity', () => {
  render(
    <RosterRow name="Player" appearance="request-header">
      <span>Status</span>
    </RosterRow>
  );
  expect(screen.getByText('Player').tagName).toBe('P');
  expect(screen.getByText('Player').parentElement?.textContent).toBe('PlayerStatus');
});
