import { describe, expect, it } from 'vitest';
import {
  ADD_MATCH_PLAYER_OK,
  addMatchPlayerError,
  parseAddMatchPlayerStatus
} from '../src/features/matches/match-add-player-model';
import { parsePlayerAddDispatch } from '../src/features/matches/match-add-player.server';
import { validateAddMatchPlayer } from '../src/features/matches/match-add-player.validators';

const id = '11111111-1111-4111-8111-111111111111';
const valid = {
  event_id: id,
  display_name: '  Ana Silva  ',
  email: '  Ana.Silva@Example.COM ',
  estimated_level: 3.5,
  locale: 'pt-BR',
  request_id: id
};

describe('validateAddMatchPlayer', () => {
  it('trims the name and normalizes the email', () => {
    expect(validateAddMatchPlayer(valid)).toEqual({
      ...valid,
      display_name: 'Ana Silva',
      email: 'ana.silva@example.com'
    });
  });

  it('accepts the level bounds 0 and 7', () => {
    expect(validateAddMatchPlayer({ ...valid, estimated_level: 0 }).estimated_level).toBe(0);
    expect(validateAddMatchPlayer({ ...valid, estimated_level: 7 }).estimated_level).toBe(7);
  });

  it.each([
    ['empty name', { display_name: '   ' }],
    ['long name', { display_name: 'a'.repeat(81) }],
    ['bad email', { email: 'not-an-email' }],
    ['empty email', { email: ' ' }],
    ['level below range', { estimated_level: -0.1 }],
    ['level above range', { estimated_level: 7.1 }],
    ['non-tenth level', { estimated_level: 3.55 }],
    ['non-finite level', { estimated_level: Number.NaN }],
    ['unsupported locale', { locale: 'fr' }],
    ['bad event id', { event_id: 'nope' }],
    ['bad request id', { request_id: 'nope' }],
    ['forged actor', { actor_id: id }],
    ['forged user', { user_id: id }]
  ])('rejects %s', (_label, patch) => {
    expect(() => validateAddMatchPlayer({ ...valid, ...patch })).toThrow('INVALID_MATCH_INPUT');
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'x', [], 4])
      expect(() => validateAddMatchPlayer(value)).toThrow('INVALID_MATCH_INPUT');
  });
});

describe('add player result mapping', () => {
  it('maps stable SQL messages and codes without leaking details', () => {
    expect(addMatchPlayerError({ code: 'P0001', message: 'MATCH_REGISTRATION_FULL' })).toEqual({
      status: 'error',
      code: 'full'
    });
    expect(addMatchPlayerError({ code: '42501', message: 'secret detail' })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
    expect(addMatchPlayerError({ code: '22023' })).toEqual({ status: 'error', code: 'invalid' });
    expect(addMatchPlayerError({ code: 'XX000', message: 'boom' })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });

  it('exposes one success shape', () => {
    expect(ADD_MATCH_PLAYER_OK).toEqual({ status: 'ok' });
  });

  it('parses command status', () => {
    expect(parseAddMatchPlayerStatus({ status: 'ok' })).toBe('ok');
    expect(parseAddMatchPlayerStatus({ status: 'rate_limited' })).toBe('rate_limited');
    expect(parseAddMatchPlayerStatus({ status: 'other' })).toBeNull();
    expect(parseAddMatchPlayerStatus(null)).toBeNull();
  });
});

describe('parsePlayerAddDispatch', () => {
  const base = { email: 'a@b.co', locale: 'en', match_event_id: id };

  it('parses create, resend and none', () => {
    expect(parsePlayerAddDispatch({ action: 'create', capability: 'abc', ...base })).toEqual({
      action: 'create',
      capability: 'abc',
      ...base
    });
    expect(parsePlayerAddDispatch({ action: 'resend', ...base })).toEqual({
      action: 'resend',
      ...base
    });
    expect(parsePlayerAddDispatch({ action: 'none' })).toEqual({ action: 'none' });
  });

  it('rejects malformed dispatches', () => {
    expect(parsePlayerAddDispatch({ action: 'create', ...base })).toBeNull();
    expect(parsePlayerAddDispatch({ action: 'resend', email: 'a@b.co' })).toBeNull();
    expect(parsePlayerAddDispatch({ action: 'x', ...base })).toBeNull();
    expect(parsePlayerAddDispatch(null)).toBeNull();
    expect(parsePlayerAddDispatch([])).toBeNull();
  });
});
