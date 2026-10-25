import { describe, expect, it } from 'vitest';
import {
  matchResultActionError,
  parseResultProposals,
  parseResultSubmission
} from '../src/features/matches/match-result-model';
import { MATCH_RESULT_ERROR_COPY } from '../src/features/matches/match-result-error-copy';
import { resultProposal, resultSuccess } from './helpers/match-result-fixtures';

describe('result decoders and error mapping', () => {
  it('retains authorized submitter display provenance without copying identity extras', () => {
    expect(
      parseResultProposals([
        { ...resultProposal, submitted_by_name: 'Recovery admin', submitted_by: 'private-extra' }
      ])
    ).toEqual([{ ...resultProposal, submitted_by_name: 'Recovery admin' }]);
  });
  it('decodes success and read projections without leaking extra fields', () => {
    const { replayed, ...value } = resultSuccess;
    expect(parseResultSubmission({ ...resultSuccess, secret: true })).toEqual({
      status: 'ok',
      value,
      replayed
    });
    expect(parseResultProposals([{ ...resultProposal, secret: true }])).toEqual([resultProposal]);
    expect(parseResultProposals([])).toEqual([]);
  });
  it.each([
    null,
    [],
    {},
    { ...resultSuccess, event_id: 'bad' },
    { ...resultSuccess, proposal_id: 'bad' },
    { ...resultSuccess, request_id: 'bad' },
    { ...resultSuccess, group_number: 0 },
    { ...resultSuccess, version: '1' },
    { ...resultSuccess, submitted_at: 'bad' },
    { ...resultSuccess, review_deadline_at: '2026-10-02T12:00:00Z' },
    { ...resultSuccess, replayed: 1 }
  ])('fails closed for malformed submission %#', (value) => {
    expect(parseResultSubmission(value)).toBeNull();
  });
  it.each([
    null,
    {},
    [null],
    [resultProposal, resultProposal],
    [{ ...resultProposal, status: 'confirmed' }],
    [{ ...resultProposal, teams: { team_a: [] } }],
    [{ ...resultProposal, teams: { ...resultProposal.teams, extra: [] } }],
    [
      {
        ...resultProposal,
        teams: { team_a: resultProposal.teams.team_a, team_b: resultProposal.teams.team_a }
      }
    ],
    [{ ...resultProposal, classification: 'draw' }],
    [{ ...resultProposal, rating_effective: true }],
    [{ ...resultProposal, played_at_offset_seconds: 60 }],
    [{ ...resultProposal, court_label: ' bad ' }],
    [{ ...resultProposal, played_at_utc: 'bad' }],
    [{ ...resultProposal, sets: [] }]
  ])('fails closed for malformed proposals %#', (value) => {
    expect(parseResultProposals(value)).toBeNull();
  });
  it('decodes typed active conflict only with safe version and deadline', () => {
    const error = { code: 'P0001', message: 'MATCH_RESULT_ACTIVE_PROPOSAL' };
    expect(
      matchResultActionError({
        ...error,
        details: JSON.stringify({
          active_version: 1,
          review_deadline_at: resultSuccess.review_deadline_at,
          secret: true
        })
      })
    ).toEqual({
      status: 'conflict',
      code: 'active_proposal',
      active_version: 1,
      review_deadline_at: resultSuccess.review_deadline_at
    });
    for (const details of [
      'broken',
      'null',
      '1',
      '{}',
      '{"active_version":0}',
      JSON.stringify({
        active_version: Number.MAX_SAFE_INTEGER + 1,
        review_deadline_at: resultSuccess.review_deadline_at
      }),
      JSON.stringify({ active_version: 1, review_deadline_at: 'bad' })
    ])
      expect(matchResultActionError({ ...error, details })).toEqual({
        status: 'error',
        code: 'unavailable'
      });
  });
  it('maps every result error token through typed translation table', () => {
    for (const [code, key] of Object.entries(MATCH_RESULT_ERROR_COPY).filter(
      ([candidate]) => candidate !== 'active_proposal'
    )) {
      expect(key).toMatch(/^matches\.results\.errors\./);
      expect(
        matchResultActionError({ code: 'P0001', message: `MATCH_RESULT_${code.toUpperCase()}` })
      ).toEqual({ status: 'error', code });
    }
    expect(new Set(Object.values(MATCH_RESULT_ERROR_COPY)).size).toBe(
      Object.keys(MATCH_RESULT_ERROR_COPY).length
    );
  });
  it('retains safe set index and side only and strips malformed private error details', () => {
    const error = { code: 'P0001', message: 'MATCH_RESULT_INVALID_SET_SCORE' };
    const detail = { set_index: 2, side: 'team_b', reason_token: 'INVALID_SET_SCORE' };
    expect(
      matchResultActionError({ ...error, details: JSON.stringify({ ...detail, secret: true }) })
    ).toEqual({ status: 'error', code: 'invalid_set_score', detail });
    for (const details of [
      'broken',
      JSON.stringify({ ...detail, set_index: 4 }),
      JSON.stringify({ ...detail, side: 'secret' }),
      JSON.stringify({ ...detail, reason_token: 'wrong' })
    ])
      expect(matchResultActionError({ ...error, details })).toEqual({
        status: 'error',
        code: 'invalid_set_score'
      });
    expect(matchResultActionError({ code: '28000' })).toEqual({
      status: 'error',
      code: 'unauthenticated'
    });
    expect(matchResultActionError({ code: '42501' })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
    expect(matchResultActionError({ message: 'private database failure' })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });
});
