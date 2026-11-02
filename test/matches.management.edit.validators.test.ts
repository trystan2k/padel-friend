import { describe, expect, it } from 'vitest';
import { validateEditMatchEvent } from '../src/features/matches/match-management.validators';
import {
  validateMergedMatchEdit,
  validateEditInstant,
  validMatchMapsUrl
} from '../src/features/matches/match-management-edit';
const id = '11111111-1111-4111-8111-111111111111';
const command = { event_id: id, expected_version: 1, request_id: id };
const current = {
  event_type: 'friendly' as const,
  league_id: null,
  venue_name: 'Court',
  maps_url: 'https://maps.google.com/maps/court',
  court_notes: null,
  price_minor: 100,
  currency: 'EUR' as const,
  payment_note: null,
  notes: null,
  maximum_registrations: 8,
  registration_cutoff_at: '2099-01-01T10:00:00Z',
  starts_at: '2099-01-01T12:00:00Z'
};
const league = 'AAAAAAAA-1111-4111-8111-111111111111';
describe('Ranked/League edit validators', () => {
  it('accepts a League id (canonical lowercase) or null for Unranked', () => {
    expect(validateEditMatchEvent({ ...command, patch: { league_id: league } }).patch).toEqual({
      league_id: league.toLowerCase()
    });
    expect(validateEditMatchEvent({ ...command, patch: { league_id: null } }).patch).toEqual({
      league_id: null
    });
  });
  it('rejects malformed League ids and non-string values', () => {
    for (const league_id of ['nope', 7, '', {}, true, undefined])
      expect(() => validateEditMatchEvent({ ...command, patch: { league_id } })).toThrow(
        'INVALID_MATCH_INPUT'
      );
  });
  it('treats league_id as part of the merged facts without changing schedule rules', () => {
    expect(validateMergedMatchEdit(current, { league_id: league }, 2).league_id).toBe(league);
    expect(() =>
      validateMergedMatchEdit(
        current,
        { league_id: league, registration_cutoff_at: current.starts_at },
        2
      )
    ).toThrow('FUTURE_CUTOFF');
  });
});
describe('minor edit validators', () => {
  it('rejects unknown nested patch keys and forged lifecycle', () => {
    for (const patch of [
      null,
      [],
      { notes: { nested: 'value' } },
      { actor_id: id },
      { status: 'open' },
      { lifecycle: 'accepted' },
      { saved_venue_id: id },
      { event_type: 'unknown' },
      { starts_at: null },
      { version: 2 },
      { venue_name: null },
      { maps_url: null },
      { registration_cutoff_at: null },
      { notes: undefined }
    ])
      expect(() => validateEditMatchEvent({ ...command, patch })).toThrow('INVALID_MATCH_INPUT');
    expect(() => validateEditMatchEvent({ ...command, patch: {}, actor_id: id })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    for (const expected_version of [0, 1.2, Number.MAX_SAFE_INTEGER + 1, '1', null])
      expect(() => validateEditMatchEvent({ ...command, expected_version, patch: {} })).toThrow(
        'INVALID_MATCH_INPUT'
      );
  });
  it('validates merged price currency and UTC instant', () => {
    const patch = validateEditMatchEvent({
      ...command,
      patch: { price_minor: 200, registration_cutoff_at: '2099-01-01T12:00:00+02:00' }
    }).patch;
    expect(patch).toEqual({ price_minor: 200, registration_cutoff_at: '2099-01-01T10:00:00.000Z' });
    expect(validateMergedMatchEdit(current, patch, 2).currency).toBe('EUR');
    expect(() => validateMergedMatchEdit(current, { currency: null }, 2)).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMergedMatchEdit(current, { price_minor: null }, 2)).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMergedMatchEdit(current, { maximum_registrations: 1 }, 2)).toThrow(
      'CAPACITY_BELOW_ACCEPTED'
    );
    expect(() =>
      validateMergedMatchEdit(current, { registration_cutoff_at: current.starts_at }, 2)
    ).toThrow('FUTURE_CUTOFF');
    expect(() =>
      validateMergedMatchEdit(current, { registration_cutoff_at: '2020-01-01T00:00:00Z' }, 2)
    ).toThrow('FUTURE_CUTOFF');
    expect(
      validateMergedMatchEdit(
        current,
        { price_minor: null, currency: null, maximum_registrations: null },
        2
      )
    ).toMatchObject({ price_minor: null, currency: null, maximum_registrations: null });
    for (const invalid of [
      { price_minor: -1 },
      { price_minor: 1.2 },
      { price_minor: Number.MAX_SAFE_INTEGER + 1 },
      { currency: 'GBP' },
      { price_minor: null, currency: 'USD' },
      { maximum_registrations: 2147483648 },
      { venue_name: ' ' },
      { notes: 'x'.repeat(2001) },
      { court_notes: 'x'.repeat(301) },
      { payment_note: 'x\ny' },
      { maps_url: 'https://maps.google.com:443/maps/x' },
      { maps_url: 'https://maps.google.com@evil.test/maps/x' }
    ])
      expect(() => validateEditMatchEvent({ ...command, patch: invalid })).toThrow(
        'INVALID_MATCH_INPUT'
      );
    for (const instant of [
      '2099-01-01',
      '2099-01-01T10:00',
      '2099-02-30T10:00:00Z',
      '2099-01-01T24:00:00Z',
      '2099-01-01T10:00:00.1234Z',
      'infinity'
    ])
      expect(() => validateEditInstant(instant)).toThrow(/INVALID_MATCH_/);
    expect(validMatchMapsUrl('https://maps.app.goo.gl/abc')).toBe(true);
    expect(validMatchMapsUrl('https://www.google.com/maps/abc?x=1#here')).toBe(true);
    expect(
      validateEditMatchEvent({
        ...command,
        patch: { notes: null, court_notes: null, payment_note: null }
      }).patch
    ).toEqual({ notes: null, court_notes: null, payment_note: null });
  });
});
