import { describe, expect, it } from 'vitest';
import {
  validateGetMatchEventResultProposals,
  validateSubmitMatchEventResult,
  validateResultPlayedLocal
} from '../src/features/matches/match-result.validators';
import { localMatchInstant } from '../src/features/matches/match-time';
import { resultCommand } from './helpers/match-result-fixtures';

describe('result request validation', () => {
  it('normalizes valid teams court and IDs without trusting extra properties', () => {
    expect(
      validateSubmitMatchEventResult({ ...resultCommand, court_label: ' Court 1 ' }).court_label
    ).toBe('Court 1');
    expect(validateGetMatchEventResultProposals({ event_id: resultCommand.event_id })).toEqual({
      event_id: resultCommand.event_id
    });
    for (const key of Object.keys(resultCommand)) {
      const missing: Record<string, unknown> = { ...resultCommand };
      delete missing[key];
      expect(() => validateSubmitMatchEventResult(missing)).toThrow('INVALID_REQUEST');
    }
    expect(() => validateSubmitMatchEventResult({ ...resultCommand, timezone: 'UTC' })).toThrow(
      'INVALID_REQUEST'
    );
    expect(() =>
      validateGetMatchEventResultProposals({ event_id: resultCommand.event_id, extra: true })
    ).toThrow('INVALID_REQUEST');
    expect(() => validateGetMatchEventResultProposals(null)).toThrow('INVALID_REQUEST');
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])(
    'rejects unsafe group %s',
    (group_number) => {
      expect(() => validateSubmitMatchEventResult({ ...resultCommand, group_number })).toThrow(
        'INVALID_REQUEST'
      );
    }
  );
  it.each(['event_id', 'request_id'])('validates %s as UUID', (key) => {
    expect(() => validateSubmitMatchEventResult({ ...resultCommand, [key]: 'bad' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
  });
  it.each(['', ' ', 'x'.repeat(101), 'Court\n3', 'Court\u007f', 3])(
    'rejects invalid court %s',
    (court_label) => {
      expect(() => validateSubmitMatchEventResult({ ...resultCommand, court_label })).toThrow(
        'INVALID_COURT'
      );
    }
  );
  it('rejects extra team and set keys and duplicate players', () => {
    expect(() =>
      validateSubmitMatchEventResult({
        ...resultCommand,
        teams: { ...resultCommand.teams, extra: [] }
      })
    ).toThrow('INVALID_TEAMS');
    expect(() =>
      validateSubmitMatchEventResult({
        ...resultCommand,
        sets: [{ ...resultCommand.sets[0], extra: 1 }]
      })
    ).toThrow('INVALID_SET');
    expect(() =>
      validateSubmitMatchEventResult({
        ...resultCommand,
        teams: { team_a: resultCommand.teams.team_a, team_b: resultCommand.teams.team_a }
      })
    ).toThrow('DUPLICATE_PLAYER');
  });
  it.each([-50400, 50400, 0, -18000])('accepts whole-minute offset %s', (offset_seconds) => {
    expect(
      validateResultPlayedLocal({ local: resultCommand.played_local.local, offset_seconds })
        .offset_seconds
    ).toBe(offset_seconds);
  });
  it.each([undefined, null, 50460, -50460, 1, 1.5, '0'])(
    'rejects missing/non-minute/out-of-range offset %s',
    (offset_seconds) => {
      expect(() =>
        validateResultPlayedLocal({ local: resultCommand.played_local.local, offset_seconds })
      ).toThrow('INVALID_PLAYED_AT');
    }
  );
  it.each([
    '2020-02-30 12:00:00',
    '2020-01-01T12:00:00',
    '2020-01-01 24:00:00',
    '2020-01-01 12:60:00',
    '2020-01-01 12:00',
    '0000-01-01 12:00:00'
  ])('rejects malformed local %s', (local) => {
    expect(() => validateResultPlayedLocal({ local, offset_seconds: 0 })).toThrow(
      'INVALID_PLAYED_AT'
    );
  });
  it('rejects injected instant and timezone at input boundary', () => {
    for (const extra of [{ instant: '2020-01-01T12:00:00Z' }, { timezone: 'UTC' }])
      expect(() => validateResultPlayedLocal({ ...resultCommand.played_local, ...extra })).toThrow(
        'INVALID_PLAYED_AT'
      );
  });
  it('reuses localMatchInstant for day rollover gaps and both explicit DST overlap choices', () => {
    expect(
      localMatchInstant('2020-01-02', '00:30:00', 'Asia/Tokyo', 32400).instant.toISOString()
    ).toBe('2020-01-01T15:30:00.000Z');
    expect(() => localMatchInstant('2020-03-08', '02:30:00', 'America/New_York', -18000)).toThrow(
      'INVALID_MATCH_LOCAL_TIME'
    );
    expect(
      localMatchInstant('2020-11-01', '01:30:00', 'America/New_York', -14400).instant.toISOString()
    ).toBe('2020-11-01T05:30:00.000Z');
    expect(
      localMatchInstant('2020-11-01', '01:30:00', 'America/New_York', -18000).instant.toISOString()
    ).toBe('2020-11-01T06:30:00.000Z');
    expect(() => localMatchInstant('2020-11-01', '01:30:00', 'America/New_York', 0)).toThrow(
      'INVALID_MATCH_LOCAL_TIME'
    );
  });
});
