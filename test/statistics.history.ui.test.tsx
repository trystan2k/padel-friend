/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createI18n } from '../src/i18n/config';
import type {
  HistoryItem,
  HistoryStatus,
  HistoryView
} from '../src/features/statistics/statistics-history-contracts';

const mocks = vi.hoisted(() => ({ history: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock('../src/features/statistics/statistics-history.functions', () => ({
  getStatisticsHistory: mocks.history
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, 'aria-label': label }: { children: ReactNode; 'aria-label'?: string }) => (
    <a href="/matches" aria-label={label}>
      {children}
    </a>
  )
}));
import { MatchHistory } from '../src/features/statistics/MatchHistory';
import { ConfirmedGroupDetail } from '../src/features/statistics/ConfirmedGroupDetail';
import { decodeGroupDetail } from '../src/features/statistics/statistics-decoders';

const id = '11111111-1111-4111-8111-111111111111';
const filters = {
  communityId: null,
  leagueId: null,
  type: 'all' as const,
  from: null,
  through: null
};
function item(status: HistoryStatus, index: number): HistoryItem {
  const confirmed = status === 'played' || status === 'incomplete';
  const group = confirmed || status === 'pending' || status === 'disputed';
  const gid = group ? id : null;
  return {
    key: String(index),
    kind: group ? 'group' : 'event',
    event_id: id,
    group_number: group ? 1 : null,
    game_group_id: gid,
    status,
    match_type: index % 2 ? 'friendly' : 'competitive',
    community_id: id,
    community_name: 'Club',
    league_id: null,
    league_name: null,
    venue_name: 'Court',
    timezone: 'UTC',
    sort_at: '2030-01-01T12:00:00Z',
    played_at: group ? '2030-01-01T12:00:00Z' : null,
    viewer_side: group ? 'team_a' : null,
    outcome: status === 'played' ? 'win' : null,
    classification: confirmed ? (status === 'played' ? 'team_a' : 'incomplete') : null,
    sets: confirmed ? [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }] : null,
    sets_a: confirmed ? 1 : null,
    sets_b: confirmed ? 0 : null,
    games_a: confirmed ? 6 : null,
    games_b: confirmed ? 4 : null,
    rating_delta: null
  };
}
const page = (items: HistoryItem[], cursor: string | null = null): HistoryView => ({
  items,
  next_cursor: cursor,
  statistics_revision: 1,
  limit: 20
});
const wrap = (node: ReactNode) => <I18nextProvider i18n={createI18n('en')}>{node}</I18nextProvider>;
afterEach(() => {
  cleanup();
  mocks.history.mockReset();
});

describe('match history UI', () => {
  it('renders lifecycle and type badges with named detail links and absent rating', () => {
    const statuses: HistoryStatus[] = [
      'played',
      'incomplete',
      'disputed',
      'canceled',
      'reserve_not_playing'
    ];
    render(wrap(<MatchHistory initial={page(statuses.map(item))} filters={filters} />));
    for (const label of ['Played', 'Incomplete', 'Disputed', 'Canceled', 'Reserve, not playing'])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('Competitive').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Friendly').length).toBeGreaterThan(0);
    const first = screen.getAllByRole('listitem')[0]!;
    expect(within(first).getByText('No rating change')).toBeTruthy();
    expect(
      within(first).getByRole('link', { name: /Result details, Competitive match/ })
    ).toBeTruthy();
    expect(screen.queryByText('0.00')).toBeNull();
  });
  it('shows unavailable and retry controls instead of an empty state', () => {
    render(
      wrap(<MatchHistory initial={null} filters={filters} initialError="STATISTICS_UNAVAILABLE" />)
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/No match history yet/)).toBeNull();
  });
  it('loads and appends a keyset page on activation', async () => {
    mocks.history.mockResolvedValue({ status: 'ok', value: page([item('disputed', 2)]) });
    render(wrap(<MatchHistory initial={page([item('played', 1)], 'cursor')} filters={filters} />));
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Disputed')).toBeTruthy();
    expect(screen.getByText('Played')).toBeTruthy();
    expect(mocks.history).toHaveBeenCalledWith({
      data: { ...filters, limit: 20, cursor: 'cursor' }
    });
  });
  it('renders explicitly absent player ratings in confirmed detail', () => {
    const rating = {
      state: 'not_applied',
      reason: 'friendly',
      before_level: null,
      after_level: null,
      delta: null,
      before_reliability: null,
      after_reliability: null,
      expected_score: null
    };
    const player = { user_id: id, display_name: 'Player', is_provisional: false, rating };
    const at = '2030-01-01T12:00:00.000000Z';
    const detail = decodeGroupDetail({
      event_id: id,
      game_group_id: id,
      group_number: 1,
      statistics_revision: 1,
      community: { id, name: 'Club' },
      venue_name: 'Court',
      court_label: null,
      timezone: 'UTC',
      starts_at: at,
      played_at: at,
      played_at_local: '2030-01-01T12:00:00',
      played_at_offset_seconds: 0,
      match_type: 'friendly',
      league: null,
      result: {
        classification: 'draw',
        winner: 'draw',
        sets: [{ position: 1, team_a_games: 2, team_b_games: 1, completed: false }],
        sets_a: 0,
        sets_b: 0,
        games_a: 2,
        games_b: 1
      },
      teams: {
        team_a: [player, { ...player, user_id: '22222222-2222-4222-8222-222222222222' }],
        team_b: [
          { ...player, user_id: '33333333-3333-4333-8333-333333333333' },
          { ...player, user_id: '44444444-4444-4444-8444-444444444444' }
        ]
      },
      rating_state: 'friendly',
      matchup: {
        team_a_strength: null,
        team_b_strength: null,
        team_a_expected: null,
        team_b_expected: null,
        upset: null,
        reason: 'friendly'
      },
      confirmation: {
        source: 'AUTO_48H',
        automatic: true,
        confirmed_at: at,
        effective_at: at,
        approver: null
      },
      submitter: { user_id: id, display_name: 'Player', submitted_at: at },
      correction: { corrected: false, version: 1 },
      timeline: []
    });
    const { rerender } = render(wrap(<ConfirmedGroupDetail detail={detail} />));
    expect(screen.getAllByText('No rating change: Friendly match')).toHaveLength(5);
    expect(screen.queryByLabelText(/Upset:/)).toBeNull();
    const override = decodeGroupDetail({
      ...detail,
      confirmation: {
        ...detail.confirmation,
        source: 'ADMIN_OVERRIDE',
        automatic: false,
        approver: { user_id: id, display_name: 'Admin' }
      },
      timeline: [
        {
          kind: 'confirmed',
          version: 1,
          occurred_at: at,
          actor: { user_id: id, display_name: 'Admin' },
          source: 'ADMIN_OVERRIDE'
        }
      ]
    });
    rerender(wrap(<ConfirmedGroupDetail detail={override} />));
    expect(screen.getByText(createI18n('en').t('matches.corrections.adminOverride'))).toBeTruthy();
    rerender(
      wrap(
        <ConfirmedGroupDetail
          detail={{ ...detail, matchup: { ...detail.matchup, reason: 'missing_evidence' } }}
        />
      )
    );
    expect(screen.queryByLabelText(/Upset:/)).toBeNull();
    expect(screen.getByText('Rating evidence missing')).toBeTruthy();
    rerender(
      wrap(
        <ConfirmedGroupDetail
          detail={{
            ...detail,
            matchup: {
              team_a_strength: 3,
              team_b_strength: 5,
              team_a_expected: 0.3,
              team_b_expected: 0.7,
              upset: true,
              reason: null
            }
          }}
        />
      )
    );
    expect(screen.getByLabelText('Upset: winning team had a low expected win chance')).toBeTruthy();
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to match' })).toBeTruthy();
  });
});

describe('confirmed group detail composition (Pencil BcpYH)', () => {
  const at = '2030-01-01T12:00:00.000000Z';
  const ids = [
    id,
    ...['2', '3', '4'].map(
      (n) =>
        n.repeat(8) +
        '-' +
        n.repeat(4) +
        '-4' +
        n.repeat(3) +
        '-8' +
        n.repeat(3) +
        '-' +
        n.repeat(12)
    )
  ];
  const player = (index: number, name: string) => ({
    user_id: ids[index]!,
    display_name: name,
    is_provisional: false,
    rating: {
      state: 'applied',
      reason: null,
      before_level: 3.8,
      after_level: 3.9,
      delta: 0.1,
      before_reliability: 60,
      after_reliability: 62,
      expected_score: 0.5
    }
  });
  const detail = () =>
    decodeGroupDetail({
      event_id: id,
      game_group_id: id,
      group_number: 1,
      statistics_revision: 1,
      community: { id, name: 'Club' },
      venue_name: 'Padel Indoor',
      court_label: null,
      timezone: 'UTC',
      starts_at: at,
      played_at: at,
      played_at_local: '2030-01-01T12:00:00',
      played_at_offset_seconds: 0,
      match_type: 'competitive',
      league: null,
      result: {
        classification: 'team_a',
        winner: 'team_a',
        sets: [
          { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
          { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
          { position: 3, team_a_games: 6, team_b_games: 3, completed: true }
        ],
        sets_a: 2,
        sets_b: 1,
        games_a: 15,
        games_b: 13
      },
      teams: {
        team_a: [player(0, 'Thiago'), player(1, 'Ana')],
        team_b: [player(2, 'Pedro'), player(3, 'Carlos')]
      },
      rating_state: 'applied',
      matchup: {
        team_a_strength: 3.9,
        team_b_strength: 4,
        team_a_expected: 0.45,
        team_b_expected: 0.55,
        upset: false,
        reason: null
      },
      confirmation: {
        source: 'MANUAL',
        automatic: false,
        confirmed_at: at,
        effective_at: at,
        approver: { user_id: ids[2]!, display_name: 'Pedro' }
      },
      submitter: { user_id: ids[0]!, display_name: 'Thiago', submitted_at: at },
      correction: { corrected: false, version: 1 },
      timeline: []
    });

  it('opens with the result hero: both teams, the set scores and the verdict line', () => {
    render(wrap(<ConfirmedGroupDetail detail={detail()} />));
    const hero = screen.getByRole('region', { name: 'Result' });
    expect(hero.textContent).toContain('Thiago and Ana');
    expect(hero.textContent).toContain('Pedro and Carlos');
    for (const score of ['6–4', '3–6', '6–3']) expect(hero.textContent).toContain(score);
    expect(within(hero).getByText('Team A won')).toBeTruthy();
    expect(within(hero).getByText('Sets 2–1 · Games 15–13')).toBeTruthy();
  });

  it('follows the hero with the team blocks, then sets, matchup, meta, confirmation and audit', () => {
    render(wrap(<ConfirmedGroupDetail detail={detail()} />));
    const names = [
      'Result',
      'Players',
      'Set scores',
      'Pre-match outlook',
      'Confirmation',
      'Audit timeline'
    ];
    const regions = names.map((name) => screen.getByRole('region', { name }));
    for (let index = 1; index < regions.length; index += 1)
      expect(
        regions[index - 1]!.compareDocumentPosition(regions[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    const meta = screen.getByText('Padel Indoor').closest('dl')!;
    expect(
      regions[2]!.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      meta.compareDocumentPosition(regions[4]!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows each team block with its set score and every player rating effect', () => {
    render(wrap(<ConfirmedGroupDetail detail={detail()} />));
    const players = screen.getByRole('region', { name: 'Players' });
    const [teamA, teamB] = within(players).getAllByRole('heading', { level: 3 });
    expect(teamA!.textContent).toBe('Team A 2');
    expect(teamB!.textContent).toBe('Team B 1');
    expect(within(players).getAllByText('3.80')).toHaveLength(4);
    expect(within(players).getAllByText('3.90')).toHaveLength(4);
    expect(within(players).getAllByText('+0.10')).toHaveLength(4);
  });
});
