import { describe, expect, it } from 'vitest';
import {
  decodeMatchRpcDetail,
  decodeMatchRpcListRows
} from '../src/features/matches/match-decoders';
import {
  parseMatchEventRatingChanges,
  parseRatingGroupExplanation
} from '../src/features/player/rating-contracts';
import { isParticipantRef } from '../src/lib/participant-ref';
import { validateMatchResultTeams } from '../src/features/matches/match-result.validators';
import { changesPayload, explanationPayload } from './helpers/rating-read-fixtures';
import { makeMatchRpcDetail, makeMatchRpcListRow } from './helpers/match-fixtures';

describe('withdrawn identities in retained history readers', () => {
  it('keeps a rating slot whose profile is gone as an empty name', () => {
    const payload = {
      ...changesPayload,
      groups: changesPayload.groups.map((group, index) => ({
        ...group,
        players: group.players.map((player, slot) =>
          index === 0 && slot === 0
            ? { ...player, display_name: null, is_provisional: false }
            : player
        )
      }))
    };
    const decoded = parseMatchEventRatingChanges(payload);
    expect(decoded?.groups[0]?.players).toHaveLength(4);
    expect(decoded?.groups[0]?.players[0]?.display_name).toBe('');
    expect(decoded?.groups[0]?.players[1]?.display_name).not.toBe('');
  });

  it('keeps an explanation slot whose profile is gone as an empty name', () => {
    const payload = {
      ...explanationPayload,
      players: explanationPayload.players.map((player, slot) =>
        slot === 0 ? { ...player, display_name: null } : player
      )
    };
    const decoded = parseRatingGroupExplanation(payload);
    expect(decoded?.players).toHaveLength(4);
    expect(decoded?.players[0]?.display_name).toBe('');
  });

  it('still rejects a non-string, non-null name', () => {
    const payload = {
      ...explanationPayload,
      players: explanationPayload.players.map((player, slot) =>
        slot === 0 ? { ...player, display_name: 42 } : player
      )
    };
    expect(parseRatingGroupExplanation(payload)).toBeNull();
  });

  it('accepts the scope-local key of a departed player as a participant, never as an id input', () => {
    const key = 'former-0123456789abcdef';
    expect(isParticipantRef(key)).toBe(true);
    expect(isParticipantRef('11111111-2222-4333-8444-555555555555')).toBe(true);
    for (const bad of ['former-xyz', 'former-0123456789abcdeF0', 'someone', '', null, 7])
      expect(isParticipantRef(bad)).toBe(false);
    const ids = [
      '11111111-2222-4333-8444-555555555555',
      key,
      'former-fedcba9876543210',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    ];
    const teams = { team_a: [ids[0], ids[1]], team_b: [ids[2], ids[3]] };
    expect(validateMatchResultTeams(teams, true).team_a[1]).toBe(key);
    // Submission input stays strict: only real user ids may be submitted.
    expect(() => validateMatchResultTeams(teams)).toThrow('INVALID_TEAMS');
    // Two departed slots must stay distinct.
    expect(() =>
      validateMatchResultTeams({ team_a: [key, key], team_b: [ids[0], ids[3]] }, true)
    ).toThrow('DUPLICATE_PLAYER');
  });

  it('keeps a scope-local key in rating slots and rejects a malformed one', () => {
    const key = 'former-0123456789abcdef';
    const payload = {
      ...changesPayload,
      groups: changesPayload.groups.map((group, index) => ({
        ...group,
        players: group.players.map((player, slot) =>
          index === 0 && slot === 0 ? { ...player, user_id: key, display_name: null } : player
        )
      }))
    };
    expect(parseMatchEventRatingChanges(payload)?.groups[0]?.players[0]?.user_id).toBe(key);
    const broken = JSON.parse(JSON.stringify(payload).replace(key, 'former-nope'));
    expect(parseMatchEventRatingChanges(broken)).toBeNull();
  });

  it('decodes the no-photo contract (detached media) but not a blank path', () => {
    expect(decodeMatchRpcDetail(makeMatchRpcDetail({ photo_path: null })).photo_path).toBeNull();
    expect(
      decodeMatchRpcListRows([makeMatchRpcListRow({ photo_path: null })])[0]?.photo_path
    ).toBeNull();
    expect(() => decodeMatchRpcDetail(makeMatchRpcDetail({ photo_path: '   ' }))).toThrow(
      'INVALID_MATCH_RESPONSE'
    );
  });
});
