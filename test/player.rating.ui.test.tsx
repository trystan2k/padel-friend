/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import {
  parseMatchEventRatingChanges,
  parseRatingHistoryPage,
  parseRatingProgress,
  type RatingErrorCode,
  type RatingHistoryView
} from '../src/features/player/rating-contracts';
import {
  changesPayload,
  explanationPayload,
  GROUP_ID,
  historyItemPayload,
  historyPayload,
  progressPayload
} from './helpers/rating-read-fixtures';

const mocks = vi.hoisted(() => ({
  history: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  explanation: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  changes: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a href={String(to).replace('$requestId', params?.requestId ?? '')} {...rest}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingHistory: mocks.history,
  getRatingGroupExplanation: mocks.explanation,
  getMatchEventRatingChanges: mocks.changes,
  getMyRatingSummary: vi.fn<() => Promise<unknown>>(),
  getMyRatingProgress: vi.fn<() => Promise<unknown>>()
}));

import { RatingError } from '../src/features/player/RatingError';
import { MatchResultRatingChanges } from '../src/features/matches/MatchResultRatingChanges';
import { RatingExplanation } from '../src/features/player/RatingExplanation';
import { RatingHistory } from '../src/features/player/RatingHistory';
import { RatingJourney } from '../src/features/player/RatingJourney';
import { RatingProgressChart } from '../src/features/player/RatingProgressChart';
import type { RatingLoad } from '../src/features/player/rating-view';

afterEach(cleanup);
beforeEach(() => {
  mocks.history.mockReset();
  mocks.explanation.mockReset();
  mocks.changes.mockReset();
});

const wrap = (node: ReactNode, locale: Locale = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

const progress = (overrides: Record<string, unknown> = {}) =>
  parseRatingProgress({ ...progressPayload, ...overrides })!;
const manyPoints = Array.from({ length: 4 }, (_, index) => ({
  ordinal: index + 1,
  kind: 'match',
  event_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  game_group_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  played_at: `2026-0${index + 1}-01T10:00:00.000000Z`,
  display_level: 4 + index * 0.1
}));
const manyProgress = () =>
  progress({
    resolution: 'sampled',
    abbreviated: true,
    total_events: 12,
    // Adjustment checkpoints are points, never games: the games copy must use total_events.
    total_points: 14,
    range: { from: manyPoints[0]!.played_at, to: manyPoints[3]!.played_at },
    points: manyPoints
  });

const historyView = (overrides: Record<string, unknown> = {}): RatingHistoryView => {
  const page = parseRatingHistoryPage({ ...historyPayload, ...overrides })!;
  return {
    ...page,
    next_cursor: page.next_cursor ? 'cursor' : null
  };
};
describe('RatingProgressChart', () => {
  it('describes one confirmed game with baseline, range and an equivalent data table', async () => {
    render(wrap(<RatingProgressChart progress={progress()} />));
    expect(screen.getByRole('heading', { name: 'Rating progression' })).toBeTruthy();
    expect(
      screen.getByText(
        '1 confirmed game between Nov 1, 2026 and Nov 1, 2026. Level moved from 4.00 to 4.12.'
      )
    ).toBeTruthy();
    expect(screen.getByText('From Nov 1, 2026')).toBeTruthy();
    expect(screen.getByText(/Lines only connect games/)).toBeTruthy();
    expect(screen.getByText('Starting level (hollow marker)')).toBeTruthy();
    expect(document.querySelectorAll('svg[aria-hidden="true"] circle')).toHaveLength(4);

    expect(screen.queryByRole('table')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show data table' });
    await userEvent.click(toggle);
    const table = screen.getByRole('table', { name: 'Level after each confirmed game' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'GameDateLevel',
      'Starting level—4.00',
      '1Nov 1, 20264.12'
    ]);
    expect(screen.getByRole('button', { name: 'Hide data table' })).toBeTruthy();
  });

  it('shows sampled progress with an honest abbreviation notice and ordered table', async () => {
    render(wrap(<RatingProgressChart progress={manyProgress()} />, 'pt-BR'));
    expect(
      screen.getByText(
        'Mostrando 4 de 12 jogos confirmados. O primeiro e o mais recente sempre aparecem.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        '12 jogos confirmados entre 1 de jan. de 2026 e 1 de abr. de 2026. O nível passou de 4,00 para 4,30.'
      )
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar tabela de dados' }));
    const levels = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').at(-1)?.textContent);
    expect(levels).toEqual(['4,00', '4,00', '4,10', '4,20', '4,30']);
  });

  it('counts only games, not displayed correction checkpoints, in the abbreviation notice', () => {
    const adjustmentPoints = [2, 3].map((ordinal, index) => ({
      ordinal: ordinal + 2,
      kind: 'adjustment',
      event_id: `00000000-0000-4000-8000-0000000000a${index + 1}`,
      game_group_id: null,
      played_at: `2026-0${ordinal + 2}-02T10:00:00.000000Z`,
      display_level: 4.5 + index * 0.1
    }));
    render(
      wrap(
        <RatingProgressChart
          progress={progress({
            resolution: 'sampled',
            abbreviated: true,
            total_events: 2,
            total_points: 4,
            range: { from: manyPoints[0]!.played_at, to: adjustmentPoints[1]!.played_at },
            points: [manyPoints[0], manyPoints[1], ...adjustmentPoints]
          })}
        />
      )
    );
    expect(
      screen.getByText(
        'Showing 2 of 2 confirmed games. The first and latest games are always included.'
      )
    ).toBeTruthy();
  });

  it('states the starting level and draws nothing when there are no points', () => {
    render(
      wrap(
        <RatingProgressChart
          progress={progress({ state: 'empty', total_events: 0, range: null, points: [] })}
        />
      )
    );
    expect(
      screen.getByText(/Starting level 4\.00\. Your confirmed competitive games/)
    ).toBeTruthy();
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says progression is unavailable instead of drawing a flat line', () => {
    render(
      wrap(
        <RatingProgressChart
          progress={progress({
            state: 'unavailable',
            baseline: null,
            range: null,
            total_events: 0,
            points: []
          })}
        />
      )
    );
    expect(screen.getByText(/appears once your player level is set up/)).toBeTruthy();
    expect(document.querySelector('svg')).toBeNull();
  });
});

describe('RatingHistory', () => {
  it('lists games with outcome text, signed change and an explain action per game', async () => {
    const onExplain = vi.fn<(...args: unknown[]) => void>();
    render(
      wrap(
        <RatingHistory
          initial={historyView()}
          onExplain={onExplain}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    expect(screen.getByRole('heading', { name: 'Recent games' })).toBeTruthy();
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Win')).toBeTruthy();
    expect(within(row).getByText('+0.12')).toBeTruthy();
    expect(within(row).getByText('Level 4.00 to 4.12')).toBeTruthy();
    expect(within(row).getByText('Reliability 10% to 16%')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 1 game')).toBeTruthy();

    const explain = screen.getByRole('button', {
      name: 'Explain rating change for group 1 played on Nov 1, 2026'
    });
    explain.focus();
    await userEvent.keyboard('{Enter}');
    expect(onExplain).toHaveBeenCalledWith(GROUP_ID, { team: 'team_a' }, explain);
  });

  it('shows the empty state only for a history with no games', () => {
    render(
      wrap(
        <RatingHistory
          initial={historyView({ state: 'empty', total_events: 0, items: [] })}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    expect(screen.getByText(/No competitive history yet/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('flags recalculated games and describes a zero change without a sign', () => {
    const page = parseRatingHistoryPage({
      ...historyPayload,
      items: [
        { ...historyItemPayload, applied_delta: 0, recalculated: true, after_display_level: 4 }
      ]
    })!;
    render(
      wrap(
        <RatingHistory
          initial={{ ...page, next_cursor: null }}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    expect(screen.getByText('Recalculated')).toBeTruthy();
    expect(screen.getByText('0.00')).toBeTruthy();
  });

  it('appends the next keyset page and hides load more at the end', async () => {
    mocks.history.mockResolvedValue({
      status: 'ok',
      value: {
        ...historyPayload,
        total_events: 2,
        items: [
          {
            ...historyItemPayload,
            game_group_id: '33333333-3333-4333-8333-333333333333',
            game_group_number: 2,
            outcome_value: 0,
            applied_delta: -0.05
          }
        ],
        next_cursor: null
      }
    });
    render(
      wrap(
        <RatingHistory
          initial={historyView({
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(mocks.history).toHaveBeenCalledWith({ data: { limit: 10, cursor: 'cursor' } });
    expect(screen.getByText('Loss')).toBeTruthy();
    expect(screen.getByText('-0.05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
  });

  it.each([
    [{ status: 'error', code: 'stale_revision' }],
    [{ status: 'ok', value: { ...historyPayload, revision: 99, next_cursor: null } }]
  ])('asks the parent to reload instead of mixing revisions (%#)', async (response) => {
    mocks.history.mockResolvedValue(response);
    const onStale = vi.fn<() => void>();
    render(
      wrap(
        <RatingHistory
          initial={historyView({
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
          onExplain={vi.fn<() => void>()}
          onStale={onStale}
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    await waitFor(() => expect(onStale).toHaveBeenCalledOnce());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps loaded games and retries through load more when it fails', async () => {
    mocks.history.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      status: 'ok',
      value: { ...historyPayload, total_events: 2, next_cursor: null }
    });
    render(
      wrap(
        <RatingHistory
          initial={historyView({
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load rating information"
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['forbidden', 'You no longer have access to this rating information.'],
    ['unauthenticated', 'Your session expired. Sign in again.']
  ] as const)('reports %s as an error, never as an empty history', async (code, text) => {
    mocks.history.mockResolvedValue({ status: 'error', code });
    render(
      wrap(
        <RatingHistory
          initial={historyView({
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(screen.queryByText(/No competitive history yet/)).toBeNull();
  });
});

function ExplanationHarness({
  onStale = vi.fn<() => void>(),
  focus = { team: 'team_a' }
}: {
  onStale?: () => void;
  focus?: { team?: 'team_a' | 'team_b'; userId?: string };
}) {
  const trigger = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<{
    groupId: string;
    revision: number;
    focus: typeof focus;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setTarget({ groupId: GROUP_ID, revision: 3, focus });
        }}
      >
        open
      </button>
      <RatingExplanation
        target={target}
        returnFocus={trigger}
        onClose={() => setTarget(null)}
        onStale={onStale}
      />
    </>
  );
}

describe('RatingExplanation', () => {
  it('shows the stored numbers for all four players, with provisional names badged', async () => {
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));

    const dialog = await screen.findByRole('dialog', { name: 'How this rating changed' });
    expect(mocks.explanation).toHaveBeenCalledWith({
      data: { game_group_id: GROUP_ID, revision: 3 }
    });
    expect(await within(dialog).findByText('Group 1 · played Nov 1, 2026')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Team A · your team' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Team B' })).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent)
    ).toEqual(['Player 1', 'Player 2Provisional', 'Player 3', 'Player 4']);
    const first = within(dialog).getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('Level4.00 to 4.12');
    expect(first.textContent).toContain('Change+0.12');
    expect(first.textContent).toContain('Reliability10% to 16%');
    expect(first.textContent).toContain('Own team strength4.250');
    expect(first.textContent).toContain('Opponent team strength4.100');
    expect(first.textContent).toContain('Expected score52%');
    expect(first.textContent).toContain('ResultWin');
    expect(first.textContent).toContain('app-wide-level 1.0.0 · configuration 1 · revision 3');
    expect(within(dialog).getByText(/not a guaranteed chance to win/)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/inviter|email|99999999/i);
  });

  it('highlights the selected player in result-screen entry points', async () => {
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<ExplanationHarness focus={{ userId: explanationPayload.players[2]!.user_id }} />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByRole('listitem');
    expect(within(dialog).queryByRole('heading', { name: /your team/ })).toBeNull();
  });

  it.each([
    [
      'clamped gain',
      { rounded_delta: 0.08, applied_delta: 0.03, clamped: true },
      /would pass the top of the 0\.00 to 7\.00 scale, so only 0\.03 was applied/
    ],
    [
      'clamped loss',
      { outcome_value: 0, rounded_delta: -0.08, applied_delta: -0.03, clamped: true },
      /would pass the bottom of the 0\.00 to 7\.00 scale, so only 0\.03 was applied/
    ],
    [
      'boundary',
      { rounded_delta: 0.04, applied_delta: 0, clamped: true },
      /already at the edge of the 0\.00 to 7\.00 scale/
    ],
    [
      'equal draw',
      { expected_score: 0.5, outcome_value: 0.5, rounded_delta: 0, applied_delta: 0 },
      /draw between evenly matched teams leaves levels unchanged/
    ],
    ['zero rounded', { rounded_delta: 0, applied_delta: 0 }, /too small to show at two decimals/],
    [
      'established reliability',
      { after_reliability_percent: 100 },
      /Reliability is fully established/
    ]
  ])('words %s honestly from stored fields', async (_name, patch, pattern) => {
    mocks.explanation.mockResolvedValue({
      status: 'ok',
      value: {
        ...explanationPayload,
        players: explanationPayload.players.map((p) => ({ ...p, ...patch }))
      }
    });
    render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findAllByText(pattern)).length).toBe(4);
  });

  it('notes recalculated calculations', async () => {
    mocks.explanation.mockResolvedValue({
      status: 'ok',
      value: {
        ...explanationPayload,
        players: explanationPayload.players.map((p) => ({ ...p, recalculated: true }))
      }
    });
    render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect((await screen.findAllByText(/updated after an earlier game was confirmed/)).length).toBe(
      4
    );
  });

  it('closes with Escape and restores focus to the control that opened it', async () => {
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<ExplanationHarness />));
    const opener = screen.getByRole('button', { name: 'open' });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('closes with the close button', async () => {
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows permission loss inside the dialog and delegates stale reloads', async () => {
    mocks.explanation.mockResolvedValueOnce({ status: 'error', code: 'forbidden' });
    const first = render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('no longer have access');
    first.unmount();

    mocks.explanation.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    const onStale = vi.fn<() => void>();
    render(wrap(<ExplanationHarness onStale={onStale} />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(onStale).toHaveBeenCalledOnce();
  });

  it('retries a transient failure', async () => {
    mocks.explanation
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ok', value: explanationPayload });
    render(wrap(<ExplanationHarness />));
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Group 1 · played Nov 1, 2026')).toBeTruthy();
  });
});

describe('RatingJourney', () => {
  const okLoad = (): RatingLoad => ({
    status: 'ok',
    revision: 3,
    summary: { revision: 3, state: 'ready', summary: null },
    progress: progress(),
    history: historyView()
  });

  it('renders the Pencil journey structure: heading, scope, chart, recent games', () => {
    render(wrap(<RatingJourney load={okLoad()} onReload={vi.fn<() => void>()} />));
    const region = screen.getByRole('region', { name: 'Rating journey' });
    expect(within(region).getByText('ALL TIME')).toBeTruthy();
    expect(within(region).getByRole('heading', { name: 'Rating progression' })).toBeTruthy();
    expect(within(region).getByRole('heading', { name: 'Recent games' })).toBeTruthy();
  });

  it('opens the explanation from a history row and returns focus afterwards', async () => {
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<RatingJourney load={okLoad()} onReload={vi.fn<() => void>()} />));
    const explain = screen.getByRole('button', { name: /^Explain rating change for group 1/ });
    explain.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Team A · your team' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(explain));
  });

  it('shows a failed load as an alert with retry, never as an empty journey', async () => {
    const onReload = vi.fn<() => void>();
    const load: RatingLoad = { status: 'error', code: 'unavailable' };
    render(wrap(<RatingJourney load={load} onReload={onReload} />));
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load rating information");
    expect(screen.queryByText(/No competitive history yet/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('RatingJourney stale reload focus', () => {
  const loadAt = (revision: number, overrides: Record<string, unknown> = {}): RatingLoad => ({
    status: 'ok',
    revision,
    summary: { revision, state: 'ready', summary: null },
    progress: progress(),
    history: historyView({ revision, ...overrides })
  });

  function Harness({ first }: { first: RatingLoad }) {
    const [load, setLoad] = useState(first);
    return <RatingJourney load={load} onReload={() => setLoad(loadAt(4))} />;
  }

  it('moves focus to the journey heading and announces when a stale dialog reloads', async () => {
    mocks.explanation.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    render(wrap(<Harness first={loadAt(3)} />));
    screen.getByRole('button', { name: /^Explain rating change for group 1/ }).focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Reload' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const heading = screen.getByRole('heading', { name: 'Rating journey' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('status').textContent).toBe('Rating journey updated.');
  });

  it('moves focus to the journey heading when load-more meets a stale revision', async () => {
    mocks.history.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    render(
      wrap(
        <Harness
          first={loadAt(3, {
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
        />
      )
    );
    screen.getByRole('button', { name: 'Load more games' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Rating journey' }))
    );
    expect(screen.getByRole('status').textContent).toBe('Rating journey updated.');
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
  });

  // First reload fails (unavailable), the retry succeeds.
  function FailingHarness({ first }: { first: RatingLoad }) {
    const [load, setLoad] = useState(first);
    const [attempt, setAttempt] = useState(0);
    return (
      <RatingJourney
        load={load}
        onReload={() => {
          setAttempt(attempt + 1);
          setLoad(attempt === 0 ? { status: 'error', code: 'unavailable' } : loadAt(4));
        }}
      />
    );
  }

  async function expectFailureThenRetry() {
    const heading = screen.getByRole('heading', { name: 'Rating journey' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole('status').textContent).toBe(
      'Could not refresh the rating journey. Use the retry option below.'
    );
    // The status is the only announcement; the error copy stays visible without a second alert.
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Rating journey updated.')
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Rating journey' }));
  }

  it('keeps focus on the heading and announces when a stale-dialog reload fails, then recovers', async () => {
    mocks.explanation.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    render(wrap(<FailingHarness first={loadAt(3)} />));
    screen.getByRole('button', { name: /^Explain rating change for group 1/ }).focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Reload' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expectFailureThenRetry();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus on the heading and announces when a stale-pagination reload fails, then recovers', async () => {
    mocks.history.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    render(
      wrap(
        <FailingHarness
          first={loadAt(3, {
            total_events: 2,
            next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
          })}
        />
      )
    );
    screen.getByRole('button', { name: 'Load more games' }).focus();
    await userEvent.keyboard('{Enter}');
    await expectFailureThenRetry();
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
  });

  it('announces sign-in copy once, with no retry wording, when the reload is unauthenticated', async () => {
    mocks.history.mockResolvedValueOnce({ status: 'error', code: 'stale_revision' });
    function ExpiredHarness() {
      const [load, setLoad] = useState(
        loadAt(3, {
          total_events: 2,
          next_cursor: { played_at: historyItemPayload.played_at, game_group_id: GROUP_ID }
        })
      );
      return (
        <RatingJourney
          load={load}
          onReload={() => setLoad({ status: 'error', code: 'unauthenticated' })}
        />
      );
    }
    render(wrap(<ExpiredHarness />));
    screen.getByRole('button', { name: 'Load more games' }).focus();
    await userEvent.keyboard('{Enter}');
    const heading = screen.getByRole('heading', { name: 'Rating journey' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Your session expired. Sign in again.');
    expect(status.textContent).not.toMatch(/retry|try again/i);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('RatingError sign-in return destination', () => {
  const assign = vi.fn<(url: string) => void>();
  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal('location', { assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const signIn = async (node: ReactNode) => {
    render(wrap(node));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    return assign.mock.calls[0]![0];
  };

  it('keeps the dashboard default for the profile journey', async () => {
    const load: RatingLoad = { status: 'error', code: 'unauthenticated' };
    expect(await signIn(<RatingJourney load={load} onReload={vi.fn<() => void>()} />)).toBe(
      '/login?next=%2Fdashboard'
    );
  });

  it('returns to the result detail URL from the rating changes', async () => {
    mocks.changes.mockResolvedValue({ status: 'error', code: 'unauthenticated' });
    expect(
      await signIn(<MatchResultRatingChanges eventId="22222222-2222-4222-8222-222222222222" />)
    ).toBe('/login?next=%2Fmatches%2F22222222-2222-4222-8222-222222222222');
  });

  it.each(['//evil.com', 'https://evil.com/x', '/\\evil.com', '/a/../b', 'javascript:alert(1)'])(
    'falls back to the dashboard for the unsafe destination %s',
    async (returnPath) => {
      expect(await signIn(<RatingError code="unauthenticated" returnPath={returnPath} />)).toBe(
        '/login?next=%2Fdashboard'
      );
    }
  );
});

describe('MatchResultRatingChanges', () => {
  it('refetches after a committed correction without changing event or group count', async () => {
    mocks.changes.mockResolvedValue({ status: 'ok', value: changesPayload });
    const { rerender } = render(wrap(<MatchResultRatingChanges eventId="e" revision={1} />));
    await waitFor(() => expect(mocks.changes).toHaveBeenCalledTimes(1));
    rerender(wrap(<MatchResultRatingChanges eventId="e" revision={2} />));
    await waitFor(() => expect(mocks.changes).toHaveBeenCalledTimes(2));
    rerender(wrap(<MatchResultRatingChanges eventId="e" revision={2} />));
    expect(mocks.changes).toHaveBeenCalledTimes(2);
  });
  it('rejects a rating response older than the committed correction revision', async () => {
    mocks.changes.mockResolvedValue({ status: 'ok', value: { ...changesPayload, revision: 1 } });
    render(wrap(<MatchResultRatingChanges eventId="e" revision={2} />));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Explain rating change/ })).toBeNull();
  });

  it('lists each played participant with change, reliability and an explain action', async () => {
    mocks.changes.mockResolvedValue({ status: 'ok', value: changesPayload });
    mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
    render(wrap(<MatchResultRatingChanges eventId="22222222-2222-4222-8222-222222222222" />));
    expect(screen.getByRole('heading', { name: 'Rating changes' })).toBeTruthy();
    const group = await screen.findByRole('heading', { name: 'Group 1' });
    const list = within(group.closest('section')!).getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[1]!.textContent).toContain('Player 2Provisional');
    expect(rows[0]!.textContent).toContain('+0.12');
    expect(rows[0]!.textContent).toContain('Reliability 10% to 16%');
    expect(screen.queryByText(/invit|adder|added by/i)).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: 'Explain rating change for Player 3, group 1' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findAllByRole('listitem')).toHaveLength(4);
  });

  it('renders nothing when no played participant has a stored change', async () => {
    mocks.changes.mockResolvedValue({
      status: 'ok',
      value: parseMatchEventRatingChanges({ ...changesPayload, groups: [] })
    });
    const { container } = render(wrap(<MatchResultRatingChanges eventId="e" />));
    await waitFor(() => expect(mocks.changes).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it.each([
    ['forbidden', 'no longer have access'],
    ['unavailable', "Couldn't load rating information"]
  ] as [RatingErrorCode, string][])('shows %s as an alert', async (code, text) => {
    mocks.changes.mockResolvedValue({ status: 'error', code });
    render(wrap(<MatchResultRatingChanges eventId="e" />));
    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });
});

const ADJUSTMENT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const adjustmentItemPayload = {
  kind: 'adjustment',
  adjustment_id: ADJUSTMENT_ID,
  level_review_request_id: REQUEST_ID,
  event_type: 'ADMIN_REVIEW_ADJUSTMENT',
  effective_at: '2026-11-03T09:00:00.000000Z',
  reason: 'Verified against club results\n<b>bold</b> https://example.com/proof',
  outcome: 'approved',
  before_display_level: 4.12,
  after_display_level: 4.6,
  before_reliability_percent: 16,
  after_reliability_percent: 16,
  reliability_changed: false,
  after_confirmed_groups: 1,
  calculation_revision: 4
};

describe('level review correction timeline', () => {
  const mixedHistory = () =>
    historyView({ total_events: 2, items: [adjustmentItemPayload, historyItemPayload] });

  it('renders an approved adjustment as a correction, never as a win or loss', () => {
    render(
      wrap(
        <RatingHistory
          initial={mixedHistory()}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Showing 1 of 2 games')).toBeTruthy();
    const correction = rows[0]!;
    expect(within(correction).getByText('Level review')).toBeTruthy();
    expect(within(correction).getByText('Level review adjustment')).toBeTruthy();
    expect(within(correction).getByText('Level 4.12 to 4.60')).toBeTruthy();
    expect(within(correction).getByText('Reliability stays at 16%')).toBeTruthy();
    expect(within(correction).queryByText(/Win|Draw|Loss/)).toBeNull();
    expect(within(correction).queryByRole('button', { name: /Explain/ })).toBeNull();
    expect(within(correction).queryByText(/^[+−-]\d/)).toBeNull();
    expect(
      within(correction).getByRole('link', { name: 'View review request' }).getAttribute('href')
    ).toBe('/level-reviews/' + REQUEST_ID);
    // The match row next to it is untouched.
    expect(within(rows[1]!).getByText('Win')).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: /Explain rating change/ })).toBeTruthy();
  });

  it('shows the reliability transition when the review recorded an exception', () => {
    render(
      wrap(
        <RatingHistory
          initial={historyView({
            total_events: 1,
            items: [
              { ...adjustmentItemPayload, reliability_changed: true, after_reliability_percent: 10 }
            ]
          })}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    expect(screen.getByText('Reliability 16% to 10%')).toBeTruthy();
  });

  it('keeps the stored note as inert text', () => {
    render(
      wrap(
        <RatingHistory
          initial={mixedHistory()}
          onExplain={vi.fn<() => void>()}
          onStale={vi.fn<() => void>()}
        />
      )
    );
    expect(document.querySelector('b')).toBeNull();
    expect(document.body.textContent).toContain('<b>bold</b> https://example.com/proof');
    expect(screen.queryByRole('link', { name: /example\.com/ })).toBeNull();
  });

  it('draws the correction as a diamond checkpoint, counts only games and labels the table row', async () => {
    const correctionProgress = progress({
      total_events: 1,
      total_points: 2,
      range: { from: '2026-11-01T10:00:00.000000Z', to: '2026-11-03T09:00:00.000000Z' },
      points: [
        progressPayload.points[0],
        {
          ordinal: 2,
          kind: 'adjustment',
          event_id: ADJUSTMENT_ID,
          game_group_id: null,
          played_at: '2026-11-03T09:00:00.000000Z',
          display_level: 4.6
        }
      ]
    });
    render(wrap(<RatingProgressChart progress={correctionProgress} />));
    // baseline + one game circle (and the two legend circles); the correction is a rotated rect.
    expect(
      document.querySelectorAll('svg[aria-hidden="true"] rect[transform^="rotate"]')
    ).toHaveLength(2);
    expect(screen.getByText('Level review correction (diamond marker)')).toBeTruthy();
    expect(
      screen.getByText(
        '1 confirmed game between Nov 1, 2026 and Nov 3, 2026. Level moved from 4.00 to 4.60.'
      )
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show data table' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'GameDateLevel',
      'Starting level—4.00',
      '1Nov 1, 20264.12',
      'Level reviewNov 3, 20264.60'
    ]);
  });

  it('does not show the correction legend without a correction', () => {
    render(wrap(<RatingProgressChart progress={progress()} />));
    expect(screen.queryByText(/Level review correction/)).toBeNull();
    expect(
      document.querySelectorAll('svg[aria-hidden="true"] rect[transform^="rotate"]')
    ).toHaveLength(0);
  });
});

describe('localized rendering', () => {
  const english = ['Rating progression', 'Recent games', 'Own team strength', 'Load more games'];
  it.each([
    ['en', ['Rating progression', 'Recent games', 'Own team strength'], [], '4.00'],
    ['pt-BR', ['Evolução do rating', 'Jogos recentes', 'Força da própria equipe'], english, '4,00'],
    [
      'es',
      ['Progresión del rating', 'Partidos recientes', 'Fuerza del propio equipo'],
      english,
      '4,00'
    ]
  ] as const)(
    'renders chart, history and explanation in %s without raw keys',
    async (locale, present, absent, level) => {
      mocks.explanation.mockResolvedValue({ status: 'ok', value: explanationPayload });
      render(
        wrap(
          <>
            <RatingProgressChart progress={manyProgress()} />
            <RatingHistory
              initial={historyView({
                items: [{ ...historyItemPayload, applied_delta: 0, after_display_level: 4 }]
              })}
              onExplain={vi.fn<() => void>()}
              onStale={vi.fn<() => void>()}
            />
            <ExplanationHarness />
          </>,
          locale
        )
      );
      await userEvent.click(screen.getByRole('button', { name: 'open' }));
      await screen.findByRole('dialog');
      expect(await screen.findAllByRole('listitem')).toHaveLength(4);
      const text = document.body.textContent;
      expect(text).not.toMatch(/\brating\.[a-zA-Z]+\./);
      expect(present.filter((phrase) => !text.includes(phrase))).toEqual([]);
      expect(
        absent.filter((phrase) => phrase !== 'Load more games' && text.includes(phrase))
      ).toEqual([]);
      expect(text).toContain(level);
    }
  );
});
