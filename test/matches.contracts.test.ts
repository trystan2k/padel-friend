import { describe, expect, it } from 'vitest';
import * as typeFixtures from './fixtures/match-contracts.types';
import { validateMatchPhotoKey } from '../src/features/matches/match-photo';
import { validatePublishMatch } from '../src/features/matches/matches.validators';
import {
  callerBadgeTone,
  participationTone,
  registrationActionTone,
  registrationSourceTone,
  registrationStateTone
} from '../src/features/matches/match-status-tone';
import {
  makeMatchCard,
  makeMatchCreationOptions,
  makeMatchDetail,
  makeMatchDraft,
  makeMatchInvitee,
  makeMatchPublishInput,
  makeMatchRpcDetail,
  makeMatchRpcListRow,
  matchCountScenario
} from './helpers/match-fixtures';

describe('match contract fixtures', () => {
  it('exports complete compile-time contract fixtures for runtime checks', () => {
    for (const fixture of Object.values(typeFixtures)) {
      expect(fixture).toBeDefined();
    }
    expect(typeFixtures.envelope).toHaveProperty('items');
    expect(typeFixtures.envelope).toHaveProperty('next_cursor');
    expect(typeFixtures.envelope).toHaveProperty('as_of');
  });
  it('maps match states exhaustively to presentation tones', () => {
    expect(participationTone).toEqual({
      playing: 'positive',
      reserve: 'neutral',
      reserve_not_playing: 'muted'
    });
    expect(registrationStateTone).toEqual({
      pending: 'neutral',
      rejected: 'danger',
      expired: 'muted'
    });
    expect(registrationActionTone).toEqual({
      join: 'positive',
      request: 'neutral',
      full: 'danger',
      closed: 'muted',
      invited: 'neutral',
      none: 'muted'
    });
    expect(registrationSourceTone).toEqual({ creator: 'muted', member: 'muted', guest: 'guest' });
    expect(callerBadgeTone).toEqual({
      reconfirmation_required: 'danger',
      creator: 'muted',
      playing: 'positive',
      reserve: 'neutral',
      reserve_not_playing: 'muted',
      invited: 'neutral'
    });
  });
  it('creates independent nested options objects', () => {
    const first = makeMatchCreationOptions();
    const second = makeMatchCreationOptions();
    expect(first).not.toBe(second);
    expect(first.communities[0]).not.toBe(second.communities[0]);
    expect(first.saved_venues[0]).not.toBe(second.saved_venues[0]);
    expect(first.level_defaults).not.toBe(second.level_defaults);
  });

  it('derives coherent roster scenarios while honoring explicit values', () => {
    // 10 accepted = 8 playing + 2 residual reserve, both of which dropped out
    // after the cutoff: the partition still totals 10.
    expect(matchCountScenario({ accepted: 10, notPlaying: 2 })).toEqual({
      accepted_count: 10,
      playing_count: 8,
      reserve_count: 0,
      reserve_not_playing_count: 2,
      group_count: 2,
      more_needed: 2
    });
    expect(matchCountScenario({ accepted: 5, playing_count: 0, more_needed: 4 })).toMatchObject({
      accepted_count: 5,
      playing_count: 0,
      reserve_count: 1,
      group_count: 1,
      more_needed: 4
    });
  });

  it('keeps every derived partition inside the accepted roster invariant', () => {
    for (const accepted of [1, 4, 5, 8, 9, 10, 13]) {
      for (const notPlaying of [0, 1, 2, 3]) {
        if (notPlaying > accepted % 4) continue;
        const counts = matchCountScenario({ accepted, notPlaying });
        expect(counts.playing_count + counts.reserve_count + counts.reserve_not_playing_count).toBe(
          accepted
        );
        expect(counts.playing_count % 4).toBe(0);
        expect(counts.group_count).toBe(Math.floor(accepted / 4));
        expect(counts.more_needed).toBe(4 - (accepted % 4));
      }
    }
  });

  it('rejects not-playing counts that exceed the residual reserve', () => {
    // accepted=8 leaves no residual reserve, accepted=9 leaves one player.
    expect(() => matchCountScenario({ accepted: 8, notPlaying: 1 })).toThrow(/residual reserve/);
    expect(() => matchCountScenario({ accepted: 9, notPlaying: 2 })).toThrow(/residual reserve/);
  });

  it('rejects negative, fractional, NaN, Infinity, and unsafe-integer inputs', () => {
    const invalidValues = [
      -1,
      5.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1
    ];
    for (const accepted of invalidValues) {
      expect(() => matchCountScenario({ accepted })).toThrow(
        /accepted must be a nonnegative safe integer/
      );
    }
    for (const notPlaying of invalidValues) {
      expect(() => matchCountScenario({ accepted: 5, notPlaying })).toThrow(
        /notPlaying must be a nonnegative safe integer/
      );
    }
  });

  it('derives all-zero counts for an empty roster', () => {
    expect(matchCountScenario({ accepted: 0 })).toEqual({
      accepted_count: 0,
      playing_count: 0,
      reserve_count: 0,
      reserve_not_playing_count: 0,
      group_count: 0,
      more_needed: 4
    });
  });

  it('defaults pass the production publication validators', () => {
    const rpcDetail = makeMatchRpcDetail();
    const listRow = makeMatchRpcListRow();
    const publishInput = makeMatchPublishInput();
    const card = makeMatchCard();
    // validateMatchPhotoKey is the exported production storage-key guard; the
    // fixture key must be community/event/owner/object UUID segments.
    expect(validateMatchPhotoKey(rpcDetail.photo_path)).toBe(rpcDetail.photo_path);
    expect(validateMatchPhotoKey(listRow.photo_path)).toBe(listRow.photo_path);
    expect(validateMatchPhotoKey(publishInput.photo_path)).toBe(publishInput.photo_path);
    // Identity consistency: the key derives from the fixture's own UUIDs.
    expect(rpcDetail.photo_path.startsWith(`${card.community_id}/${card.event_id}/`)).toBe(true);
    expect(
      validatePublishMatch({ event_id: card.event_id, input: publishInput, invitee_ids: [] })
    ).toHaveProperty('input');
    // There is no exported TS maps-URL validator: publication is guarded by the
    // public.valid_match_maps_url Postgres check (migration
    // 20261016120000_match_event_domain.sql), so its documented rule is
    // replicated here.
    const mapsUrls = [
      card.maps_url,
      makeMatchCreationOptions().saved_venues[0]?.maps_url,
      publishInput.maps_url
    ];
    for (const url of mapsUrls) expect(validMatchMapsUrl(url)).toBe(true);
  });

  it('provides complete nullable defaults and RPC-specific keys', () => {
    const card = makeMatchCard();
    expect(card.photo_url).toBeNull();
    expect(card.currency).toBeNull();
    expect(card.min_level).toBeNull();
    expect(card.caller_badge).toBe('creator');
    expect(makeMatchRpcDetail()).toHaveProperty('as_of');
    expect(makeMatchRpcDetail()).toHaveProperty('photo_path');
    expect(makeMatchRpcDetail()).not.toHaveProperty('cursor');
    expect(makeMatchRpcListRow()).toHaveProperty('cursor');
    expect(makeMatchRpcListRow()).toHaveProperty('as_of');
    expect(makeMatchDetail()).toHaveProperty('photo_url');
    expect(makeMatchCreationOptions()).toHaveProperty('level_defaults.level');
    expect(makeMatchDraft()).toHaveProperty('cutoff', '');
    expect(makeMatchInvitee()).toHaveProperty('user_id');
    expect(makeMatchPublishInput()).toHaveProperty('photo_path');
  });
});

// Replicates public.valid_match_maps_url: non-root path on an allowlisted
// Google Maps host, no credentials in the host, bounded plain URLs.
function validMatchMapsUrl(url: string | null | undefined): boolean {
  if (url === null || url === undefined) return false;
  if (url.length > 2048 || url !== url.trim()) return false;
  let hasControlChar = false;
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      hasControlChar = true;
      break;
    }
  }
  if (hasControlChar) return false;
  const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return false;
  const host = (match[1] ?? '').toLowerCase();
  const path = match[2] ?? '';
  if (/[@:]/.test(host)) return false;
  return (
    (((host === 'google.com' || host === 'www.google.com') && path.startsWith('/maps/')) ||
      ((host === 'maps.google.com' || host === 'maps.app.goo.gl') && path.startsWith('/')) ||
      (host === 'goo.gl' && path.startsWith('/maps/'))) &&
    path.length > 1
  );
}
