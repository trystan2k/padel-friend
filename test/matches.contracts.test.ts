import { describe, expect, it } from 'vitest';
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
    expect(matchCountScenario({ accepted: 10, notPlaying: 2 })).toEqual({
      accepted_count: 10,
      playing_count: 8,
      reserve_count: 2,
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
