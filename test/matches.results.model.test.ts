import { describe, expect, it } from 'vitest';
import {
  matchResultActionError,
  matchResultCommandError,
  parseOfficialResultFacts,
  parseResultCommandReceipt,
  parseResultProposals,
  parseResultSubmission
} from '../src/features/matches/match-result-model';
import { MATCH_RESULT_ERROR_COPY } from '../src/features/matches/match-result-error-copy';
import { resultIds, resultProposal, resultSuccess } from './helpers/match-result-fixtures';

describe('result decoders and error mapping', () => {
  it('retains authorized submitter provenance without copying unknown payload fields', () => {
    const parsed = parseResultProposals([
      {
        ...resultProposal,
        submitted_by_name: 'Recovery admin',
        version_timeline: [
          { ...resultProposal.version_timeline[0]!, submitted_by_name: 'Recovery admin' }
        ],
        secret: 'private-extra'
      }
    ]);
    expect(parsed?.[0]?.submitted_by_name).toBe('Recovery admin');
    expect(parsed?.[0]).not.toHaveProperty('secret');
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
  it('decodes pending, disputed, and confirmed lifecycle shapes without coercion', () => {
    const pending = parseResultProposals([resultProposal]);
    expect(pending?.[0]).toMatchObject({ status: 'pending', version: 1, confirmation: null });

    const reject = {
      reviewer_id: resultIds[1]!,
      reviewer_name: 'Reviewer',
      decision: 'reject',
      reason_code: 'SCORE_INCORRECT',
      reason_note: 'Score differs.',
      decided_at: '2026-10-01T13:00:00Z'
    } as const;
    const disputed = parseResultProposals([
      {
        ...resultProposal,
        status: 'disputed',
        caller_decision: 'reject',
        dispute_evidence: {
          rejector_id: reject.reviewer_id,
          rejector_name: reject.reviewer_name,
          reason_code: reject.reason_code,
          reason_note: reject.reason_note,
          decided_at: reject.decided_at
        },
        version_timeline: [
          { ...resultProposal.version_timeline[0]!, status: 'disputed', decisions: [reject] }
        ]
      }
    ]);
    expect(disputed?.[0]).toMatchObject({
      status: 'disputed',
      dispute_evidence: { reason_code: 'SCORE_INCORRECT' }
    });

    const confirmation = {
      confirmation_id: resultIds[3],
      source: 'MANUAL',
      confirmed_at: '2026-10-01T13:00:00Z',
      effective_at: '2026-10-01T13:00:00Z',
      actor_id: resultIds[2]
    } as const;
    const approval = {
      reviewer_id: resultIds[2]!,
      reviewer_name: 'Reviewer',
      decision: 'approve',
      reason_code: null,
      reason_note: null,
      decided_at: confirmation.confirmed_at
    } as const;
    const confirmed = parseResultProposals([
      {
        ...resultProposal,
        status: 'confirmed',
        team_b_approval_count: 1,
        received_team_coverage_count: 1,
        confirmation,
        version_timeline: [
          {
            ...resultProposal.version_timeline[0]!,
            status: 'confirmed',
            decisions: [approval],
            confirmation_id: confirmation.confirmation_id
          }
        ]
      }
    ]);
    expect(confirmed?.[0]).toMatchObject({
      status: 'confirmed',
      confirmation: { confirmation_id: resultIds[3], source: 'MANUAL' },
      received_team_coverage_count: 1
    });
  });
  it.each([
    { ...resultProposal, status: 'pending', confirmation: { confirmation_id: resultIds[3] } },
    { ...resultProposal, status: 'disputed', dispute_evidence: null },
    { ...resultProposal, status: 'confirmed', confirmation: null },
    { ...resultProposal, status: 'pending', can_approve: true, caller_decision: 'approve' },
    { ...resultProposal, required_team_coverage_count: 2 },
    { ...resultProposal, received_team_coverage_count: 1 },
    { ...resultProposal, version_timeline: [] },
    {
      ...resultProposal,
      version_timeline: [
        { ...resultProposal.version_timeline[0]!, review_deadline_at: '2026-10-02T12:00:00Z' }
      ]
    }
  ])('rejects invalid lifecycle combinations %#', (value) => {
    expect(parseResultProposals([value])).toBeNull();
  });
  it('decodes authoritative result receipts and rejects impossible confirmation identities', () => {
    const receipt = {
      proposal_id: resultProposal.proposal_id,
      version: 1,
      status: 'pending',
      confirmation_id: null,
      review_deadline_at: resultProposal.review_deadline_at,
      request_id: resultSuccess.request_id,
      replayed: false
    };
    expect(parseResultCommandReceipt(receipt)).toEqual({
      status: 'ok',
      value: {
        proposal_id: resultProposal.proposal_id,
        version: 1,
        status: 'pending',
        confirmation_id: null,
        review_deadline_at: resultProposal.review_deadline_at,
        request_id: resultSuccess.request_id
      },
      replayed: false
    });
    expect(
      parseResultCommandReceipt({ ...receipt, status: 'confirmed', confirmation_id: null })
    ).toBeNull();
    expect(parseResultCommandReceipt({ ...receipt, conflict: 'deadline_elapsed' })).toBeNull();
  });
  it('decodes only confirmation-backed official facts and frozen eligibility', () => {
    const official = {
      event_id: resultProposal.event_id,
      confirmation_id: resultIds[3],
      proposal_id: resultProposal.proposal_id,
      group_number: 1,
      version: 1,
      source: 'MANUAL',
      confirmed_at: '2026-10-01T13:00:00Z',
      effective_at: '2026-10-01T13:00:00Z',
      actor_id: resultIds[2],
      event_type: 'friendly',
      ratable_eligible: false,
      teams: {
        team_a: resultProposal.teams.team_a.map((player) => player.user_id),
        team_b: resultProposal.teams.team_b.map((player) => player.user_id)
      },
      sets: resultProposal.sets,
      classification: 'incomplete',
      played_at_utc: resultProposal.played_at_utc,
      played_at_local: resultProposal.played_at_local,
      played_at_offset_seconds: 0,
      court_label: null
    };
    expect(parseOfficialResultFacts([official], resultProposal.event_id)).toMatchObject([
      { confirmation_id: resultIds[3], event_type: 'friendly', ratable_eligible: false }
    ]);
    expect(
      parseOfficialResultFacts([{ ...official, ratable_eligible: true }], resultProposal.event_id)
    ).toBeNull();
    expect(
      parseOfficialResultFacts([{ ...official, event_id: resultIds[2] }], resultProposal.event_id)
    ).toBeNull();
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
  it('maps stale review conflicts from safe SQL details and never leaks raw errors', () => {
    expect(
      matchResultCommandError({
        code: 'P0001',
        message: 'MATCH_RESULT_REVIEW_VERSION_CONFLICT',
        details: JSON.stringify({ current_version: 2, current_status: 'disputed', private: true })
      })
    ).toEqual({
      status: 'conflict',
      code: 'stale_version',
      current_version: 2,
      current_status: 'disputed'
    });
    expect(
      matchResultCommandError({
        code: 'P0001',
        message: 'MATCH_RESULT_CORRECTION_CONFLICT',
        details: JSON.stringify({ current_version: 0, current_status: 'confirmed' })
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
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
