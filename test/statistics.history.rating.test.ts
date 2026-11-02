import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { ConfirmedGroupDetail } from '../src/features/statistics/ConfirmedGroupDetail';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children
}));
import { decodeGroupDetail } from '../src/features/statistics/statistics-decoders';

const id = '11111111-1111-4111-8111-111111111111';
const at = '2030-01-01T12:30:00.000000Z';

function detail(reason: 'friendly' | 'incomplete') {
  const rating = {
    state: 'not_applied',
    reason,
    before_level: null,
    after_level: null,
    delta: null,
    before_reliability: null,
    after_reliability: null,
    expected_score: null
  };
  const player = { user_id: id, display_name: 'Player', is_provisional: false, rating };
  return {
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
    played_at_local: '2030-01-01T12:30:00',
    played_at_offset_seconds: 0,
    match_type: reason === 'friendly' ? 'friendly' : 'competitive',
    league: null,
    result: {
      classification: reason === 'incomplete' ? 'incomplete' : 'draw',
      winner: reason === 'incomplete' ? null : 'draw',
      sets: [{ position: 1, team_a_games: 2, team_b_games: 1, completed: false }],
      sets_a: 0,
      sets_b: 0,
      games_a: 2,
      games_b: 1
    },
    teams: { team_a: [player, player], team_b: [player, player] },
    rating_state: reason,
    matchup: {
      team_a_strength: null,
      team_b_strength: null,
      team_a_expected: null,
      team_b_expected: null,
      upset: null,
      reason
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
  };
}

describe('absent history rating evidence', () => {
  it.each(['friendly', 'incomplete'] as const)('decodes %s without fabricated levels', (reason) => {
    const parsed = decodeGroupDetail(detail(reason));
    expect(parsed.teams.team_a[0]?.rating).toMatchObject({
      state: 'not_applied',
      reason,
      before_level: null,
      after_level: null,
      delta: null
    });
  });

  it('rejects partial figures when rating was not applied', () => {
    const value = detail('friendly');
    const invalidPlayer = {
      ...value.teams.team_a[0]!,
      rating: { ...value.teams.team_a[0]!.rating, before_level: 4 }
    };
    expect(() =>
      decodeGroupDetail({
        ...value,
        teams: { ...value.teams, team_a: [invalidPlayer, value.teams.team_a[1]] }
      })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });
  it('uses manual confirmation wording even when the approver name is unavailable', () => {
    const value = detail('friendly');
    const manual = decodeGroupDetail({
      ...value,
      confirmation: {
        ...value.confirmation,
        source: 'MANUAL',
        automatic: false,
        approver: { user_id: id, display_name: null }
      }
    });
    const auto = decodeGroupDetail(value);
    const render = (group: typeof manual) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n: createI18n('en') },
          createElement(ConfirmedGroupDetail, { detail: group })
        )
      );
    expect(render(manual)).toContain('Approved by Player');
    expect(render(manual)).not.toContain('Confirmed automatically after the 48-hour review window');
    expect(render(auto)).toContain('Confirmed automatically after the 48-hour review window');
  });
});
