import { describe, expect, it } from 'vitest';
import {
  decodeLeagueDetail,
  decodeLeagueDto,
  decodeLeagueList
} from '../src/features/leagues/league-decoders';
import { leagueErrorCode, leagueErrorFromDatabase } from '../src/features/leagues/league-errors';
import {
  defaultLeagueFormValues,
  formatLeagueDay,
  leagueFormFieldForError,
  todayInZone,
  validateLeagueForm,
  type LeagueFormValues
} from '../src/features/leagues/league-form';
import {
  validateCreateLeague,
  validateLeagueCommand,
  validateLeagueCommunity,
  validateLeagueId,
  validateUpdateLeague
} from '../src/features/leagues/league.validators';
import {
  LEAGUE_COMMUNITY_ID,
  LEAGUE_ID,
  makeLeagueDetail,
  makeLeagueDto,
  makeLeagueList,
  makeManualLeagueDto
} from './helpers/league-dto-fixtures';

const request_id = '44444444-4444-4444-8444-444444444444';
const createInput = {
  request_id,
  community_id: LEAGUE_COMMUNITY_ID,
  name: 'Autumn League',
  description: null,
  end_mode: 'fixed_date',
  start_date: '2030-10-01',
  end_date: '2030-12-20',
  minimum_matches: 1
};

describe('League server-function validators', () => {
  it('accepts a Fixed and a Manual creation and keeps the period coherent', () => {
    expect(validateCreateLeague(createInput)).toEqual(createInput);
    expect(
      validateCreateLeague({ ...createInput, end_mode: 'manual', end_date: null, description: 'x' })
    ).toMatchObject({ end_mode: 'manual', end_date: null, description: 'x' });
  });

  it.each([
    ['unknown key', { ...createInput, extra: true }],
    ['non-object', 'league'],
    ['array', []],
    ['bad request id', { ...createInput, request_id: 'nope' }],
    ['empty name', { ...createInput, name: '' }],
    ['edge whitespace name', { ...createInput, name: ' Autumn' }],
    ['overlong name', { ...createInput, name: 'a'.repeat(81) }],
    ['overlong description', { ...createInput, description: 'a'.repeat(501) }],
    ['blank description', { ...createInput, description: '' }],
    ['NUL in name', { ...createInput, name: 'a\u0000b' }],
    ['unknown mode', { ...createInput, end_mode: 'draft' }],
    ['impossible start date', { ...createInput, start_date: '2030-02-31' }],
    ['malformed start date', { ...createInput, start_date: '10/01/2030' }],
    ['missing fixed end', { ...createInput, end_date: null }],
    ['equal end', { ...createInput, end_date: '2030-10-01' }],
    ['reversed end', { ...createInput, end_date: '2030-09-01' }],
    ['manual with an end', { ...createInput, end_mode: 'manual' }],
    ['minimum below range', { ...createInput, minimum_matches: 0 }],
    ['minimum above range', { ...createInput, minimum_matches: 101 }],
    ['fractional minimum', { ...createInput, minimum_matches: 1.5 }],
    ['string minimum', { ...createInput, minimum_matches: '1' }]
  ])('rejects creation input: %s', (_name, input) => {
    expect(() => validateCreateLeague(input)).toThrow('INVALID_LEAGUE_INPUT');
  });

  it('validates identifiers and expected versions', () => {
    expect(validateLeagueCommunity({ community_id: LEAGUE_COMMUNITY_ID })).toEqual({
      community_id: LEAGUE_COMMUNITY_ID
    });
    expect(validateLeagueId({ league_id: LEAGUE_ID })).toEqual({ league_id: LEAGUE_ID });
    expect(validateLeagueCommand({ league_id: LEAGUE_ID, expected_version: 3 })).toEqual({
      league_id: LEAGUE_ID,
      expected_version: 3
    });
    for (const bad of [
      () => validateLeagueCommunity({ community_id: 'x' }),
      () => validateLeagueId({ league_id: LEAGUE_ID, extra: 1 }),
      () => validateLeagueCommand({ league_id: LEAGUE_ID, expected_version: 0 }),
      () => validateLeagueCommand({ league_id: LEAGUE_ID, expected_version: '1' }),
      () => validateLeagueCommand({ league_id: LEAGUE_ID })
    ])
      expect(bad).toThrow('INVALID_LEAGUE_INPUT');
  });

  it('accepts partial updates and rejects empty or unknown ones', () => {
    expect(
      validateUpdateLeague({
        league_id: LEAGUE_ID,
        expected_version: 2,
        changes: {
          name: 'Spring',
          description: null,
          minimum_matches_for_final_award: 5,
          end_mode: 'manual',
          start_date: '2030-10-02',
          end_date: null
        }
      }).changes
    ).toEqual({
      name: 'Spring',
      description: null,
      minimum_matches_for_final_award: 5,
      end_mode: 'manual',
      start_date: '2030-10-02',
      end_date: null
    });
    for (const changes of [
      {},
      { owner_id: LEAGUE_ID },
      { name: ' x ' },
      { end_date: '2030-13-01' }
    ])
      expect(() =>
        validateUpdateLeague({ league_id: LEAGUE_ID, expected_version: 1, changes })
      ).toThrow('INVALID_LEAGUE_INPUT');
    expect(() => validateUpdateLeague({ league_id: LEAGUE_ID, expected_version: 1 })).toThrow(
      'INVALID_LEAGUE_INPUT'
    );
  });
});

describe('League response decoders', () => {
  it('decodes valid Fixed and Manual Leagues and list/detail envelopes', () => {
    expect(decodeLeagueDto(makeLeagueDto())).toEqual(makeLeagueDto());
    expect(decodeLeagueDto(makeManualLeagueDto({ status: 'active' }))).toMatchObject({
      end_mode: 'manual',
      end_at: null
    });
    const list = makeLeagueList([makeLeagueDto()]);
    expect(decodeLeagueList(list)).toEqual(list);
    const detail = makeLeagueDetail();
    expect(decodeLeagueDetail(detail)).toEqual(detail);
  });

  it.each([
    ['extra key', { ...makeLeagueDto(), leaked: 1 }],
    ['missing key', (({ version: _v, ...rest }) => rest)(makeLeagueDto())],
    ['fixed without end', { ...makeLeagueDto(), end_at: null, end_date: null }],
    ['manual with end', { ...makeManualLeagueDto(), end_at: '2030-12-20T22:59:59.999999Z' }],
    ['unknown status', { ...makeLeagueDto(), status: 'draft' }],
    ['unsupported timezone', { ...makeLeagueDto(), timezone: 'America/Sao_Paulo' }],
    [
      'blocked but not upcoming',
      { ...makeLeagueDto(), status: 'active', blocked_reason: 'active_league_exists' }
    ],
    ['unknown blocked reason', { ...makeLeagueDto(), blocked_reason: 'because' }],
    ['non-microsecond instant', { ...makeLeagueDto(), start_at: '2030-09-30T22:00:00Z' }],
    ['zero version', { ...makeLeagueDto(), version: 0 }],
    ['fractional minimum', { ...makeLeagueDto(), minimum_matches_for_final_award: 1.5 }],
    ['bad id', { ...makeLeagueDto(), id: 'x' }],
    ['non-boolean capability', { ...makeLeagueDto(), can_manage: 'yes' }],
    ['null', null],
    ['array', []]
  ])('rejects a malformed League: %s', (_name, value) => {
    expect(() => decodeLeagueDto(value)).toThrow('INVALID_LEAGUE_RESPONSE');
  });

  it('rejects malformed envelopes', () => {
    expect(() => decodeLeagueList({ community: makeLeagueList().community, leagues: {} })).toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
    expect(() => decodeLeagueList({ ...makeLeagueList(), extra: 1 })).toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
    expect(() =>
      decodeLeagueDetail({
        community: { ...makeLeagueList().community, can_create: 1 },
        league: makeLeagueDto()
      })
    ).toThrow('INVALID_LEAGUE_RESPONSE');
  });
});

describe('League error mapping', () => {
  it('maps known database messages and hides everything else', () => {
    expect(leagueErrorFromDatabase({ message: 'LEAGUE_ACTIVE_EXISTS' })).toBe(
      'LEAGUE_ACTIVE_EXISTS'
    );
    expect(leagueErrorFromDatabase({ message: 'PROVISIONAL_PLAYER_RESTRICTED' })).toBe(
      'PROVISIONAL_PLAYER_RESTRICTED'
    );
    expect(leagueErrorFromDatabase({ message: 'relation "leagues" does not exist' })).toBe(
      'LEAGUE_UNAVAILABLE'
    );
    expect(leagueErrorFromDatabase({})).toBe('LEAGUE_UNAVAILABLE');
  });

  it('recovers the code from a server-function failure', () => {
    expect(leagueErrorCode(new Error('LEAGUE_VERSION_CONFLICT'))).toBe('LEAGUE_VERSION_CONFLICT');
    expect(leagueErrorCode(new Error('INVALID_LEAGUE_INPUT'))).toBe('INVALID_LEAGUE_INPUT');
    expect(leagueErrorCode(new Error('boom'))).toBe('LEAGUE_UNAVAILABLE');
    expect(leagueErrorCode('LEAGUE_FORBIDDEN')).toBe('LEAGUE_UNAVAILABLE');
  });
});

describe('League form model', () => {
  const today = '2030-06-15';
  const values = (overrides: Partial<LeagueFormValues> = {}): LeagueFormValues => ({
    ...defaultLeagueFormValues(today),
    name: 'Autumn League',
    endDate: '2030-09-15',
    ...overrides
  });

  it('defaults to a Fixed End Date League starting today with a minimum of 1', () => {
    expect(defaultLeagueFormValues(today)).toEqual({
      name: '',
      description: '',
      endMode: 'fixed_date',
      startDate: today,
      endDate: '',
      minimumMatches: '1'
    });
  });

  it('builds trimmed input for both modes', () => {
    expect(
      validateLeagueForm(values({ name: '  Autumn League  ', description: '  ' }), today).input
    ).toEqual({
      name: 'Autumn League',
      description: null,
      end_mode: 'fixed_date',
      start_date: today,
      end_date: '2030-09-15',
      minimum_matches: 1
    });
    expect(
      validateLeagueForm(values({ endMode: 'manual', endDate: '', description: ' Notes ' }), today)
        .input
    ).toMatchObject({ end_mode: 'manual', end_date: null, description: 'Notes' });
  });

  it('reports every invalid field', () => {
    expect(
      validateLeagueForm(
        values({ name: ' ', startDate: '2030-06-14', endDate: '', minimumMatches: '0' }),
        today
      ).errors
    ).toEqual({
      name: 'nameRequired',
      startDate: 'startInPast',
      endDate: 'endRequired',
      minimumMatches: 'minimumInvalid'
    });
    expect(validateLeagueForm(values({ name: 'a'.repeat(81) }), today).errors.name).toBe(
      'nameTooLong'
    );
    expect(
      validateLeagueForm(values({ description: 'a'.repeat(501) }), today).errors.description
    ).toBe('descriptionTooLong');
    expect(validateLeagueForm(values({ startDate: '' }), today).errors.startDate).toBe(
      'startRequired'
    );
    expect(validateLeagueForm(values({ minimumMatches: '1.5' }), today).errors.minimumMatches).toBe(
      'minimumInvalid'
    );
    expect(validateLeagueForm(values({ minimumMatches: '101' }), today).errors.minimumMatches).toBe(
      'minimumInvalid'
    );
  });

  it('rejects equal and reversed end dates but not a Manual League without one', () => {
    expect(validateLeagueForm(values({ endDate: today }), today).errors.endDate).toBe(
      'endNotAfterStart'
    );
    expect(validateLeagueForm(values({ endDate: '2030-06-01' }), today).errors.endDate).toBe(
      'endNotAfterStart'
    );
    expect(validateLeagueForm(values({ endMode: 'manual', endDate: '' }), today).errors).toEqual(
      {}
    );
  });

  it('exempts an unchanged past start date when editing', () => {
    expect(
      validateLeagueForm(values({ startDate: '2030-06-01' }), today, '2030-06-01').errors
    ).toEqual({});
    expect(
      validateLeagueForm(values({ startDate: '2030-06-02' }), today, '2030-06-01').errors.startDate
    ).toBe('startInPast');
  });

  it('maps server rejections to the field the user can fix', () => {
    expect(leagueFormFieldForError('LEAGUE_END_NOT_AFTER_START')).toEqual({
      field: 'endDate',
      key: 'endNotAfterStart'
    });
    expect(leagueFormFieldForError('LEAGUE_END_IN_PAST')).toEqual({
      field: 'endDate',
      key: 'endInPast'
    });
    expect(leagueFormFieldForError('LEAGUE_START_IN_PAST')).toEqual({
      field: 'startDate',
      key: 'startInPast'
    });
    expect(leagueFormFieldForError('LEAGUE_NAME_INVALID')?.field).toBe('name');
    expect(leagueFormFieldForError('LEAGUE_DESCRIPTION_INVALID')?.field).toBe('description');
    expect(leagueFormFieldForError('LEAGUE_MINIMUM_INVALID')?.field).toBe('minimumMatches');
    expect(leagueFormFieldForError('LEAGUE_START_DATE_INVALID')?.field).toBe('startDate');
    expect(leagueFormFieldForError('LEAGUE_END_DATE_REQUIRED')?.field).toBe('endDate');
    expect(leagueFormFieldForError('LEAGUE_ACTIVE_EXISTS')).toBeNull();
  });

  it('computes the community-local day across the two supported zones', () => {
    const instant = new Date('2030-06-15T23:30:00Z');
    expect(todayInZone('UTC', instant)).toBe('2030-06-15');
    expect(todayInZone('Europe/Madrid', instant)).toBe('2030-06-16');
    expect(formatLeagueDay('2030-10-01', 'en')).toBe('Oct 01, 2030');
  });
});
