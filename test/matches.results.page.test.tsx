/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { makeMatchDetail } from './helpers/match-fixtures';
import { makeMatchManagement } from './helpers/match-management-capabilities';
import type { ManagementParticipant } from '../src/features/matches/match-management-model';
import type { MatchRosterEntry } from '../src/features/matches/match-registration-model';
import type {
  MatchResultResponse,
  ResultSubmission
} from '../src/features/matches/match-result-model';
import { resultGroupPlayers, resultPlayedOffsets } from '../src/features/matches/match-result-form';
import { resultProposal } from './helpers/match-result-fixtures';
import { parseResultProposals } from '../src/features/matches/match-result-model';

vi.mock('../src/features/matches/match-result.functions', () => ({
  submitMatchEventResult: vi.fn<() => void>(),
  reviewMatchEventResult: vi.fn<() => void>(),
  correctMatchEventResult: vi.fn<() => void>()
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: import('react').ReactNode }) => <a href="/matches">{children}</a>
}));
import { RecordMatchResultPage } from '../src/features/matches/RecordMatchResultPage';
import { MatchResultPending } from '../src/features/matches/MatchResultPending';
import { MatchResultDetail } from '../src/features/matches/MatchResultDetail';
import { MatchDetailPage } from '../src/features/matches/MatchDetailPage';
const id = '11111111-1111-4111-8111-111111111111';
const players: ManagementParticipant[] = ['Ana', 'Bea', 'Carlos', 'Davi'].map((name, index) => ({
  user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  registration_id: id,
  attempt_id: id,
  display_name: name,
  display_level: null,
  lifecycle: 'accepted',
  participation: 'playing',
  accepted_order: index + 1
}));
const roster: MatchRosterEntry[] = players.map((p) => ({
  display_name: p.display_name,
  display_level: null,
  participation: 'playing',
  accepted_order: p.accepted_order,
  group_number: 1,
  reserve_position: null,
  registration_source: 'member'
}));
const reload = vi.fn<() => void>();
const submit = vi.fn<(...args: unknown[]) => Promise<MatchResultResponse<ResultSubmission>>>();
function mount(
  friendly = false,
  management = makeMatchManagement({
    correction: { available: true, target: 'record_result', event_id: id }
  }),
  timezone = 'UTC'
) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <RecordMatchResultPage
        event={makeMatchDetail({
          event_id: id,
          timezone,
          event_type: friendly ? 'friendly' : 'competitive'
        })}
        management={management}
        roster={roster}
        participants={players}
        proposals={[]}
        onReload={reload}
        onSubmit={submit}
      />
    </I18nextProvider>
  );
}
async function scoreStep() {
  await userEvent.click(screen.getByRole('button', { name: 'Confirm teams' }));
}
function score(number: number, a: number, b: number) {
  const row = screen.getByRole('group', { name: `SET ${number}` });
  for (const [team, value] of [
    ['Team A', a],
    ['Team B', b]
  ] as const) {
    const input = within(row).getByLabelText(team);
    fireEvent.change(input, { target: { value: String(value) } });
    fireEvent.blur(input);
  }
}
async function complete(number: number) {
  await userEvent.click(
    screen.getByRole('button', { name: new RegExp(`Set ${number} completion`) })
  );
}
function played() {
  fireEvent.change(screen.getByLabelText('Played on (UTC)'), {
    target: { value: '2026-10-20T18:30' }
  });
  fireEvent.blur(screen.getByLabelText('Played on (UTC)'));
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('record result page', () => {
  it('includes each visible state verbatim in its accessible name and preserves pressed state', async () => {
    mount();
    await scoreStep();
    const assertNames = () => {
      for (const button of screen
        .getAllByRole('button')
        .filter((control) =>
          ['COMPLETE', 'IN PROGRESS', 'INVALID', 'NOT PLAYED'].includes(control.textContent ?? '')
        )) {
        expect(button.getAttribute('aria-label')).toContain(button.textContent);
      }
    };
    assertNames();
    score(1, 6, 4);
    await complete(1);
    assertNames();
    expect(
      screen.getByRole('button', { name: /Set 1 completion/ }).getAttribute('aria-pressed')
    ).toBe('true');
    score(1, 6, 5);
    assertNames();
    expect(screen.getByRole('button', { name: /Set 1 completion/ }).textContent).toBe('INVALID');
  });
  it('never previews 3–0 after a completed straight-set pair', async () => {
    mount();
    await scoreStep();
    score(1, 6, 4);
    await complete(1);
    await userEvent.click(screen.getByRole('button', { name: /Add set/ }));
    score(2, 6, 4);
    await complete(2);
    await userEvent.click(screen.getByRole('button', { name: /Add set/ }));
    score(3, 5, 3);
    expect(screen.getByText('TEAM A WINS · 2–0')).toBeTruthy();
    score(3, 6, 3);
    await complete(3);
    expect(screen.queryByText('TEAM A WINS · 3–0')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'SET 3' })).getByRole('alert')).toBeTruthy();
  });
  it('uses authoritative venue and address data in the pending hero map link', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultDetail
          event={makeMatchDetail({
            venue_name: 'PADEL INDOOR MADRID',
            notes: 'Friday open play',
            court_notes: 'Calle de Alcalá',
            photo_url: 'https://example.com/court.jpg',
            maps_url: 'https://maps.google.com/madrid',
            starts_at: '2026-10-23T18:30:00Z',
            timezone: 'UTC'
          })}
          proposals={[]}
          canRecord={false}
          onRefresh={vi.fn<() => void>()}
        />
      </I18nextProvider>
    );
    expect(screen.getByText('PADEL INDOOR MADRID')).toBeTruthy();
    const map = screen.getByRole('link', { name: /Calle de Alcalá.*Open map/ });
    expect(map.getAttribute('href')).toBe('https://maps.google.com/madrid');
    expect(map.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('img', { name: 'Match venue' }).getAttribute('src')).toBe(
      'https://example.com/court.jpg'
    );
    expect(screen.getByText('Fri, 23 Oct · 18:30–20:00')).toBeTruthy();
  });
  it('shows pending status, provenance and facts without inventing review eligibility', () => {
    const proposal = parseResultProposals([
      {
        ...resultProposal,
        submitted_by_name: 'Recovery admin',
        version_timeline: [
          { ...resultProposal.version_timeline[0]!, submitted_by_name: 'Recovery admin' }
        ]
      }
    ])?.[0];
    if (!proposal) throw new Error('Invalid proposal fixture');
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultPending proposal={proposal} timezone="UTC" asOf={resultProposal.submitted_at} />
      </I18nextProvider>
    );
    expect(screen.getByText('PENDING · NOT CONFIRMED')).toBeTruthy();
    expect(
      screen.getByText('If nobody rejects by deadline, proposal confirms automatically.')
    ).toBeTruthy();
    expect(screen.getByText(/Submitted by Recovery admin/)).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /review proposal/i })).toBeNull();
  });
  it('renders three steps and explicitly confirms suggested teams', async () => {
    mount();
    for (const step of ['PLAYERS', 'SCORE', 'REVIEW'])
      expect(screen.getByText(new RegExp(step))).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    await scoreStep();
    expect(screen.getByRole('group', { name: 'SET 1' })).toBeTruthy();
    expect(screen.getByText('INCOMPLETE')).toBeTruthy();
    expect(screen.getByText('Incomplete · no rating effect')).toBeTruthy();
  });
  it('swaps actual teams without duplicating a player', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Change teams' }));
    fireEvent.change(screen.getByLabelText('Team A · player 2'), {
      target: { value: players[2]!.user_id }
    });
    expect(screen.getByLabelText<HTMLSelectElement>('Team A · player 2').value).toBe(
      players[2]!.user_id
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Team B · player 1').value).toBe(
      players[1]!.user_id
    );
  });
  it('identifies invalid set index and side inline and prevents submission', async () => {
    mount();
    await scoreStep();
    score(1, 6, 5);
    await complete(1);
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    const row = screen.getByRole('group', { name: 'SET 1' });
    expect(within(row).getByRole('alert').textContent).toContain(
      'Set 1 · Team B: 6–5 is not a completed set'
    );
    expect(within(row).getByLabelText('Team B').getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Submit for review' }).disabled
    ).toBe(true);
    expect(screen.getByText('Correct Set 1 before reviewing the result.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
  it('previews incomplete and friendly results without rating effect', async () => {
    mount(true);
    await scoreStep();
    score(1, 6, 4);
    await complete(1);
    expect(screen.getByText('INCOMPLETE')).toBeTruthy();
    expect(screen.getByText('Friendly · no rating effect')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Add set/ }));
    score(2, 6, 4);
    await complete(2);
    expect(screen.getByText('TEAM A WINS · 2–0')).toBeTruthy();
    expect(screen.getByText('Friendly · no rating effect')).toBeTruthy();
  });
  it('previews a draw with an unfinished third set and recaps facts', async () => {
    mount();
    await scoreStep();
    score(1, 6, 4);
    await complete(1);
    await userEvent.click(screen.getByRole('button', { name: /Add set/ }));
    score(2, 4, 6);
    await complete(2);
    await userEvent.click(screen.getByRole('button', { name: /Add set/ }));
    score(3, 3, 2);
    played();
    expect(screen.getByText('DRAW · third set unfinished')).toBeTruthy();
    expect(screen.getByText('Competitive · rating will update')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(screen.getByRole('region', { name: 'Set scores' }).textContent).toContain('SET 3');
    expect(screen.getByRole('region', { name: 'Set scores' }).textContent).toContain('IN PROGRESS');
    expect(screen.getByText('20 Oct 2026 · 18:30')).toBeTruthy();
  });
  it('prompts explicit reload on conflict, never automatically retries', async () => {
    submit.mockResolvedValue({
      status: 'conflict',
      code: 'active_proposal',
      active_version: 1,
      review_deadline_at: '2026-10-24T18:30:00Z'
    });
    mount();
    await scoreStep();
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(screen.getByText(/Another result is already pending/)).toBeTruthy());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest result and roster' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('renders server invalid-set details in the offending row', async () => {
    submit.mockResolvedValue({
      status: 'error',
      code: 'invalid_set_score',
      detail: { set_index: 1, side: 'team_b', reason_token: 'INVALID_SET_SCORE' }
    });
    mount();
    await scoreStep();
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'SET 1' })).getByRole('alert').textContent
      ).toContain('Set 1 · Team B')
    );
  });
  it('returns invalid-team details to the offending team for correction', async () => {
    submit.mockResolvedValue({
      status: 'error',
      code: 'duplicate_player',
      detail: { set_index: null, side: 'team_b', reason_token: 'DUPLICATE_PLAYER' }
    });
    mount();
    await scoreStep();
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() =>
      expect(screen.getByText(/Team B: A player cannot appear twice/)).toBeTruthy()
    );
    expect(screen.getByLabelText('Team B · player 1').getAttribute('aria-invalid')).toBe('true');
  });
  it('reveals explicit offset choice only during a repeated local time', async () => {
    mount(false, undefined, 'America/New_York');
    await scoreStep();
    const label = 'This time occurs twice. Choose its UTC offset.';
    expect(screen.queryByLabelText(label)).toBeNull();
    fireEvent.change(screen.getByLabelText('Played on (America/New_York)'), {
      target: { value: '2026-11-01T01:30' }
    });
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByRole('option', { name: '-04:00' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '-05:00' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Played on (America/New_York)'), {
      target: { value: '2026-11-01T03:30' }
    });
    expect(screen.queryByLabelText(label)).toBeNull();
  });
  it('does not offer recording when descriptor forbids it', () => {
    mount(false, makeMatchManagement({ correction: { available: false, reason: 'forbidden' } }));
    expect(screen.queryByRole('button', { name: 'Confirm teams' })).toBeNull();
  });
  it('shows creator/admin entry even when roster-management actions are locked', () => {
    const event = makeMatchDetail({ event_id: id, is_past: true });
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage
          event={event}
          management={makeMatchManagement({
            is_organizer: false,
            results_protected: true,
            correction: { available: true, target: 'record_result', event_id: id }
          })}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('link', { name: 'Record result' })).toBeTruthy();
  });
  it('does not advertise post-match result entry on upcoming event detail', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage
          event={makeMatchDetail({ event_id: id, is_past: false })}
          management={makeMatchManagement({
            is_organizer: false,
            results_protected: true,
            correction: { available: true, target: 'record_result', event_id: id }
          })}
        />
      </I18nextProvider>
    );
    expect(screen.queryByRole('link', { name: 'Record result' })).toBeNull();
  });
  it('disables submission during flight and shows a pending receipt', async () => {
    let resolve: ((result: MatchResultResponse<ResultSubmission>) => void) | undefined;
    submit.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    mount();
    await scoreStep();
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Submitting result…' }).disabled
    ).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      data: {
        request_id: expect.any(String),
        teams: {
          team_a: players.slice(0, 2).map((p) => p.user_id),
          team_b: players.slice(2).map((p) => p.user_id)
        }
      }
    });
    resolve?.({
      status: 'ok',
      replayed: false,
      value: {
        event_id: id,
        proposal_id: id,
        group_number: 1,
        version: 1,
        request_id: id,
        submitted_at: '2026-10-21T18:00:00Z',
        review_deadline_at: '2026-10-23T18:00:00Z'
      }
    });
    await waitFor(() => expect(screen.getByText('PENDING · NOT CONFIRMED')).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'PENDING · NOT CONFIRMED' })
    );
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  });
  it('retains request identity for an explicit network retry of identical facts', async () => {
    submit.mockRejectedValue(new Error('offline'));
    mount();
    await scoreStep();
    played();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() =>
      expect(screen.getByText(/Results could not be loaded or submitted/)).toBeTruthy()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
  it('exposes version, deadline and countdown without applying effects', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchResultPending
          timezone="UTC"
          asOf="2026-10-23T00:00:00Z"
          proposal={{
            event_id: id,
            proposal_id: id,
            group_number: 1,
            version: 1,
            request_id: id,
            submitted_at: '2026-10-21T18:00:00Z',
            review_deadline_at: '2026-10-23T18:00:00Z'
          }}
        />
      </I18nextProvider>
    );
    expect(screen.getByText('PENDING · NOT CONFIRMED')).toBeTruthy();
    expect(screen.getByText('AUTO-CONFIRMS IN 18H')).toBeTruthy();
    expect(screen.getByText(/Version 1/)).toBeTruthy();
    expect(screen.getByText(/Auto-confirm deadline:/)).toBeTruthy();
  });
});
describe('result form adapters', () => {
  it('uses actual roster group numbers and playing rows, not ordinal arithmetic', () => {
    expect(
      resultGroupPlayers(
        [{ ...roster[0]!, accepted_order: 9, group_number: 2 }],
        [{ ...players[0]!, accepted_order: 9 }],
        2
      )
    ).toHaveLength(1);
    expect(
      resultGroupPlayers(roster, [{ ...players[0]!, participation: 'reserve_not_playing' }], 1)
    ).toEqual([]);
  });
  it('only requests an offset for ambiguous local instants', () => {
    expect(resultPlayedOffsets('2026-11-01', '01:30', 'America/New_York')).toEqual([
      -14400, -18000
    ]);
    expect(resultPlayedOffsets('2026-03-08', '02:30', 'America/New_York')).toEqual([]);
    expect(resultPlayedOffsets('2026-10-20', '18:30', 'UTC')).toEqual([0]);
  });
});
