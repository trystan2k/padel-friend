/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { MatchRosterCard } from '../src/features/matches/MatchRosterCard';
import type { ManagementParticipant } from '../src/features/matches/match-management-model';
import type { MatchRosterEntry } from '../src/features/matches/match-registration-model';

vi.mock('../src/features/matches/MatchParticipantActions', () => ({
  MatchParticipantActions: ({ name, disabled }: { name: string; disabled: boolean }) => (
    <button type="button" disabled={disabled} aria-label={name}>
      ⋯
    </button>
  )
}));
afterEach(cleanup);

const roster: MatchRosterEntry[] = [
  {
    accepted_order: 1,
    display_name: 'Management Host',
    display_level: 3.2,
    participation: 'playing',
    registration_source: 'creator',
    group_number: 1,
    reserve_position: null
  },
  {
    accepted_order: 7,
    display_name: 'Management Player 5',
    display_level: 3.2,
    participation: 'reserve_not_playing',
    registration_source: 'member',
    group_number: null,
    reserve_position: 3
  }
];
const awaiting: ManagementParticipant = {
  registration_id: 'registration',
  user_id: 'player',
  attempt_id: 'attempt',
  display_name: 'Management Player 8',
  display_level: 3.2,
  lifecycle: 'accepted',
  participation: null,
  accepted_order: 9,
  required_generation: 2,
  confirmed_generation: 1
};

function mount(extra: Partial<Parameters<typeof MatchRosterCard>[0]> = {}) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <MatchRosterCard eventId="event" callerOrder={1} roster={roster} {...extra} />
    </I18nextProvider>
  );
}

describe('frame-driven roster card', () => {
  it.each([false, true])('groups cutoff reserves by participation (started=%s)', (started) => {
    mount({
      started,
      roster: [
        ...roster,
        {
          ...roster[1]!,
          accepted_order: 8,
          display_name: 'Live reserve',
          participation: 'reserve',
          reserve_position: 4
        }
      ]
    });
    expect(screen.getByRole('heading', { name: 'Players in this match' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'RESERVE QUEUE' })).toBeTruthy();
    const notPlaying = screen.getByRole('heading', { name: 'NOT PLAYING' }).parentElement!;
    const reserve = screen.getByRole('heading', { name: 'RESERVE QUEUE' }).parentElement!;
    expect(within(notPlaying).getByText('Management Player 5')).toBeTruthy();
    expect(within(reserve).getByText('Live reserve')).toBeTruthy();
    expect(within(reserve).queryByText('Management Player 5')).toBeNull();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('P5')).toBeTruthy();
    expect(screen.getByLabelText('Level 3.2').textContent).toBe('3.2');
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('Management Host')).toBeNull();
    expect(screen.getByText('Y').getAttribute('aria-hidden')).toBe('true');
  });

  it('separates outstanding consent without losing queue order or exposing a self-remove action', () => {
    mount({ participants: [awaiting], disabled: true });
    expect(screen.getByRole('heading', { name: 'Participants · Manage roster' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Awaiting reconfirmation' })).toBeTruthy();
    expect(screen.getByText('Not playing · Awaiting reconfirmation')).toBeTruthy();
    expect(screen.getByText('Management Player 8')).toBeTruthy();
    expect(screen.getByText('P8')).toBeTruthy();
    expect(screen.getByText('Level 3.2 · Playing')).toBeTruthy();
    expect(screen.getByText('Level 3.2 · Reserve #3')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Management Player 8' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'You' })).toBeNull();
    expect(screen.getByText(/Awaiting players keep capacity and queue order/)).toBeTruthy();
  });

  it('does not invent a quartet for a player still awaiting consent', () => {
    mount({ roster: [], participants: [awaiting] });
    expect(screen.queryByRole('heading', { name: /GROUP/ })).toBeNull();
    expect(screen.getAllByText('Management Player 8')).toHaveLength(1);
  });
});
