import { describe, expect, it } from 'vitest';
import {
  decodeMatchCreationOptions,
  decodeMatchInvitees,
  decodeMatchRpcDetail,
  decodeMatchRpcListRows,
  signedMatchDetail
} from '../src/features/matches/match-decoders';
import {
  makeMatchCreationOptions,
  makeMatchInvitee,
  makeMatchRpcDetail,
  makeMatchRpcListRow
} from './helpers/match-fixtures';

describe('match RPC decoders', () => {
  it('decodes complete options, canonical invitees and empty collections', () => {
    const options = makeMatchCreationOptions();
    expect(decodeMatchCreationOptions(options)).toEqual(options);
    expect(
      decodeMatchCreationOptions({ communities: [], saved_venues: [], level_defaults: null })
    ).toEqual({
      communities: [],
      saved_venues: [],
      level_defaults: null
    });
    expect(decodeMatchInvitees([makeMatchInvitee()])).toEqual([makeMatchInvitee()]);
    expect(decodeMatchInvitees([])).toEqual([]);
  });

  it('decodes valid raw rows and returns only known fields', () => {
    const detail = makeMatchRpcDetail();
    const decodedDetail = decodeMatchRpcDetail({ ...detail, secret: { private: true } });
    expect(decodedDetail).not.toHaveProperty('secret');
    expect(decodeMatchRpcListRows([makeMatchRpcListRow()])).toHaveLength(1);
    expect(signedMatchDetail(decodedDetail, null)).toMatchObject({
      photo_url: null,
      as_of: detail.as_of
    });
  });

  it('rejects unsupported currencies while preserving null and supported currencies', () => {
    const detail = makeMatchRpcDetail({ price_minor: 500, currency: 'EUR' });
    expect(decodeMatchRpcDetail(detail).currency).toBe('EUR');
    expect(
      decodeMatchRpcDetail({ ...detail, price_minor: null, currency: null }).currency
    ).toBeNull();

    const missingCurrency = (({ currency: _currency, ...rest }) => rest)(detail);
    for (const corrupted of [
      { ...detail, currency: '' },
      { ...detail, currency: 'EURO' },
      { ...detail, currency: 7 },
      missingCurrency
    ])
      expect(() => decodeMatchRpcDetail(corrupted)).toThrow('INVALID_MATCH_RESPONSE');
  });

  it('rejects missing required fields, wrong primitives, enums, counts and timestamps', () => {
    const detail = makeMatchRpcDetail();
    for (const corrupted of [
      (({ as_of: _asOf, ...rest }) => rest)(detail),
      { ...detail, accepted_count: Number.NaN },
      { ...detail, accepted_count: -1 },
      { ...detail, playing_count: Infinity },
      { ...detail, registration_open: 'true' },
      { ...detail, event_type: 'social' },
      { ...detail, timezone: 'Mars/Olympus' },
      { ...detail, starts_at: 'not a date' }
    ])
      expect(() => decodeMatchRpcDetail(corrupted)).toThrow('INVALID_MATCH_RESPONSE');
    expect(() => decodeMatchRpcListRows({})).toThrow('INVALID_MATCH_RESPONSE');
    expect(() => decodeMatchRpcListRows([{ ...makeMatchRpcListRow(), cursor: undefined }])).toThrow(
      'INVALID_MATCH_RESPONSE'
    );
  });

  it('requires nullable keys and nested option arrays with valid shape', () => {
    const options = makeMatchCreationOptions();
    const community = options.communities[0];
    if (!community) throw new Error('Expected fixture community');
    expect(() =>
      decodeMatchCreationOptions({
        ...options,
        communities: [{ id: community.id, name: community.name }]
      })
    ).toThrow('INVALID_MATCH_RESPONSE');
    expect(() => decodeMatchCreationOptions({ ...options, saved_venues: [{}] })).toThrow(
      'INVALID_MATCH_RESPONSE'
    );
    expect(() => decodeMatchInvitees([{ user_id: 'user', display_name: null }])).toThrow(
      'INVALID_MATCH_RESPONSE'
    );
  });

  it('normalizes unknown badge tokens to null but rejects missing badge property', () => {
    const raw = makeMatchRpcDetail();
    expect(decodeMatchRpcDetail({ ...raw, caller_badge: 'future_badge' }).caller_badge).toBeNull();
    const { caller_badge: _badge, ...withoutBadge } = raw;
    expect(() => decodeMatchRpcDetail(withoutBadge)).toThrow('INVALID_MATCH_RESPONSE');
  });
});
