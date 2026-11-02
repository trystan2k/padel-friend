import { describe, expect, it } from 'vitest';
import {
  competitionEffect,
  competitionImpactSide,
  competitionImpactWindow,
  parseCompetitionImpact,
  parseMatchConsentChange,
  type MatchCompetitionSide
} from '../src/features/matches/match-consent-change';

const side = (overrides: Partial<MatchCompetitionSide> = {}): MatchCompetitionSide => ({
  status: 'unranked',
  leagueId: null,
  leagueName: null,
  window: null,
  ...overrides
});
const impact = {
  competition_status: 'ranked',
  league_id: '44444444-4444-4444-8444-444444444444',
  league_name: 'Spring',
  league_start_at: '2099-01-01T23:30:00.000Z',
  league_end_at: '2099-03-01T00:00:00.000Z',
  league_timezone: 'Europe/Madrid'
};

describe('competition change helpers', () => {
  it('classifies every Ranked/League transition', () => {
    const a = side({ status: 'ranked', leagueId: 'a' });
    const b = side({ status: 'ranked', leagueId: 'b' });
    expect(competitionEffect(a, a)).toBe('unchanged');
    expect(competitionEffect(a, b)).toBe('leagueSwitch');
    expect(competitionEffect(a, side())).toBe('rankedToUnranked');
    expect(competitionEffect(side(), a)).toBe('unrankedToRanked');
    expect(competitionEffect(a, side({ status: null }))).toBe('noLongerCompetitive');
    expect(competitionEffect(side({ status: null }), side())).toBe('nowCompetitive');
  });
  it('decodes impact evidence defensively', () => {
    expect(parseCompetitionImpact(null)).toBeNull();
    expect(parseCompetitionImpact([])).toBeNull();
    expect(parseCompetitionImpact({ competition_status: 'bogus', league_name: 7 })).toEqual({
      competition_status: null,
      league_id: null,
      league_name: null,
      league_start_at: null,
      league_end_at: null,
      league_timezone: null
    });
    expect(parseCompetitionImpact(impact)).toMatchObject({
      competition_status: 'ranked',
      league_name: 'Spring'
    });
  });
  it('requires a coherent consent change and ignores missing evidence', () => {
    expect(parseMatchConsentChange(null)).toBeNull();
    expect(parseMatchConsentChange({ generation: 1, changed_fields: [1] })).toBeNull();
    expect(parseMatchConsentChange({ generation: 1.5, changed_fields: [] })).toBeNull();
    // Pre-League edits carry no competition snapshot: no summary, never a crash.
    expect(
      parseMatchConsentChange({
        generation: 1,
        changed_fields: ['starts_at'],
        from: null,
        to: null
      })
    ).toBeNull();
    expect(
      parseMatchConsentChange({
        generation: 2,
        changed_fields: ['league_id'],
        from: { competition_status: 'unranked' },
        to: impact
      })
    ).toMatchObject({ generation: 2, to: { league_name: 'Spring' } });
  });
  it('derives League-local calendar days from the stored instants', () => {
    // 23:30Z is already the next day in Europe/Madrid.
    expect(competitionImpactWindow(parseCompetitionImpact(impact))).toEqual({
      start_date: '2099-01-02',
      end_date: '2099-03-01'
    });
    expect(competitionImpactWindow(null)).toBeNull();
    expect(
      competitionImpactWindow(parseCompetitionImpact({ competition_status: 'unranked' }))
    ).toBeNull();
    expect(
      competitionImpactWindow(parseCompetitionImpact({ ...impact, league_end_at: null }))
    ).toMatchObject({ end_date: null });
    expect(competitionImpactSide(parseCompetitionImpact(impact))).toMatchObject({
      status: 'ranked',
      leagueName: 'Spring',
      window: { start_date: '2099-01-02' }
    });
    expect(competitionImpactSide(null)).toEqual({
      status: null,
      leagueId: null,
      leagueName: null,
      window: null
    });
  });
});
