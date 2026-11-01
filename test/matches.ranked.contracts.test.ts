import { describe, expect, it } from 'vitest';
import {
  decodeMatchLeagueOptions,
  decodeMatchRpcDetail,
  decodeMatchRpcListRows
} from '../src/features/matches/match-decoders';
import {
  formatMatchLeaguePeriod,
  matchCompetitionInput,
  resolveMatchCompetition
} from '../src/features/matches/match-league-selection';
import { matchRegistrationActionError } from '../src/features/matches/match-registration-model';
import { matchRegistrationAction } from '../src/features/matches/MatchRegistrationPanel';
import {
  validateMatchLeagueOptions,
  validatePublishMatch
} from '../src/features/matches/matches.validators';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import {
  makeMatchCard,
  makeMatchLeagueOption,
  makeMatchPublishInput,
  makeMatchRpcDetail,
  makeMatchRpcListRow
} from './helpers/match-fixtures';

const leagueA = makeMatchLeagueOption({ id: '44444444-4444-4444-8444-444444444444' });
const leagueB = makeMatchLeagueOption({
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Summer League'
});
const eventId = '66666666-6666-4666-8666-666666666666';
const publish = (input: object) =>
  validatePublishMatch({ event_id: eventId, input, invitee_ids: [] });

describe('resolveMatchCompetition', () => {
  it('is Unranked when no League covers the schedule, whatever the stored choice', () => {
    for (const choice of ['auto', 'ranked', 'unranked'] as const)
      expect(resolveMatchCompetition(choice, leagueA.id, [])).toEqual({
        competition: 'unranked',
        league: null,
        needsSelection: false
      });
  });

  it('defaults to Ranked with the single candidate selected', () => {
    expect(resolveMatchCompetition('auto', '', [leagueA])).toEqual({
      competition: 'ranked',
      league: leagueA,
      needsSelection: false
    });
  });

  it('keeps Ranked intent with no selected League when several candidates exist', () => {
    expect(resolveMatchCompetition('auto', '', [leagueA, leagueB])).toEqual({
      competition: 'ranked',
      league: null,
      needsSelection: true
    });
    expect(resolveMatchCompetition('ranked', 'unknown-id', [leagueA, leagueB]).needsSelection).toBe(
      true
    );
    expect(resolveMatchCompetition('auto', leagueB.id, [leagueA, leagueB]).league).toBe(leagueB);
  });

  it('honors a deliberate opt-out for any candidate set', () => {
    expect(resolveMatchCompetition('unranked', leagueA.id, [leagueA]).competition).toBe('unranked');
    expect(resolveMatchCompetition('unranked', '', [leagueA, leagueB]).needsSelection).toBe(false);
  });

  it('builds publish keys only for Competitive events', () => {
    expect(
      matchCompetitionInput('friendly', resolveMatchCompetition('auto', '', [leagueA]))
    ).toEqual({});
    expect(
      matchCompetitionInput('competitive', resolveMatchCompetition('auto', '', [leagueA]))
    ).toEqual({ competition: 'ranked', league_id: leagueA.id });
    expect(matchCompetitionInput('competitive', resolveMatchCompetition('auto', '', []))).toEqual({
      competition: 'unranked',
      league_id: null
    });
  });

  it('formats League periods with locale-specific dates and an open end for Manual Leagues', () => {
    const fixed = makeMatchLeagueOption({ start_date: '2030-06-01', end_date: '2030-07-31' });
    expect(formatMatchLeaguePeriod(fixed, 'en')).toContain('Jun 1, 2030');
    expect(formatMatchLeaguePeriod(fixed, 'es')).toMatch(/1 jun 2030/);
    expect(formatMatchLeaguePeriod(fixed, 'pt-BR')).toMatch(/1 de jun\.? de 2030/);
    const manual = makeMatchLeagueOption({ end_mode: 'manual', end_at: null, end_date: null });
    expect(formatMatchLeaguePeriod(manual, 'en')).toBe('Jun 1, 2030 –');
  });
});

describe('Ranked publish validation', () => {
  const publishRaw = (patch: Record<string, unknown>) =>
    publish({ ...makeMatchPublishInput(), ...patch });
  const competitive = { event_type: 'competitive' } as const;

  it('accepts consistent competition intent and passes it through', () => {
    expect(
      publish(
        makeMatchPublishInput({ ...competitive, competition: 'ranked', league_id: leagueA.id })
      ).input
    ).toMatchObject({ competition: 'ranked', league_id: leagueA.id });
    expect(
      publish(makeMatchPublishInput({ ...competitive, competition: 'unranked', league_id: null }))
        .input
    ).toMatchObject({ competition: 'unranked', league_id: null });
    expect(publish(makeMatchPublishInput()).input).not.toHaveProperty('competition');
  });

  it.each([
    ['Ranked without League', { competition: 'ranked', league_id: null }],
    ['Unranked with League', { competition: 'unranked', league_id: leagueA.id }],
    ['Friendly with League', { event_type: 'friendly', league_id: leagueA.id }],
    ['Friendly Ranked', { event_type: 'friendly', competition: 'ranked', league_id: leagueA.id }],
    ['unknown competition', { ...competitive, competition: 'casual' }],
    ['malformed League id', { ...competitive, competition: 'ranked', league_id: 'not-a-uuid' }]
  ] as Array<[string, Record<string, unknown>]>)('rejects %s', (_label, patch) => {
    expect(() => publishRaw(patch)).toThrow('INVALID_MATCH_INPUT');
  });

  it('validates the League options request strictly', () => {
    const data = { community_id: eventId, date: '2030-05-20', start_time: '18:30' };
    expect(validateMatchLeagueOptions(data)).toEqual(data);
    expect(() => validateMatchLeagueOptions({ ...data, date: '20/05/2030' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMatchLeagueOptions({ ...data, start_time: '25:00' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMatchLeagueOptions({ ...data, extra: 1 })).toThrow('INVALID_MATCH_INPUT');
    expect(() => validateMatchLeagueOptions({ ...data, community_id: 'x' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
  });
});

describe('Ranked decoders', () => {
  const optionsPayload = {
    starts_at: '2030-05-20T16:30:00.000000Z',
    leagues: [leagueA, makeMatchLeagueOption({ end_mode: 'manual', end_at: null, end_date: null })]
  };

  it('decodes eligible League options', () => {
    expect(decodeMatchLeagueOptions(optionsPayload).leagues).toHaveLength(2);
    expect(decodeMatchLeagueOptions({ ...optionsPayload, leagues: [] }).leagues).toEqual([]);
  });

  it.each([
    ['closed status', { ...leagueA, status: 'closed' }],
    ['Manual League with an end', { ...leagueA, end_mode: 'manual' }],
    ['Fixed League without an end', { ...leagueA, end_at: null, end_date: null }],
    ['extra field', { ...leagueA, owner_id: 'x' }],
    ['missing name', { ...leagueA, name: '' }]
  ])('rejects malformed League options: %s', (_label, league) => {
    expect(() => decodeMatchLeagueOptions({ ...optionsPayload, leagues: [league] })).toThrow(
      'INVALID_MATCH_RESPONSE'
    );
  });

  it('requires the derived competition projection on event detail and list rows', () => {
    const ranked = makeMatchRpcDetail({
      event_type: 'competitive',
      competition_status: 'ranked',
      league_id: leagueA.id,
      league_name: 'Spring League'
    });
    expect(decodeMatchRpcDetail(ranked)).toMatchObject({
      competition_status: 'ranked',
      league_id: leagueA.id,
      league_name: 'Spring League'
    });
    expect(decodeMatchRpcListRows([makeMatchRpcListRow()])[0]).toMatchObject({
      competition_status: null,
      league_id: null
    });
    const { competition_status: _removed, ...incomplete } = makeMatchRpcDetail();
    expect(() => decodeMatchRpcDetail(incomplete)).toThrow('INVALID_MATCH_RESPONSE');
    expect(() =>
      decodeMatchRpcDetail({ ...makeMatchRpcDetail(), competition_status: 'casual' })
    ).toThrow('INVALID_MATCH_RESPONSE');
  });

  it('accepts the members-only eligibility token', () => {
    const detail = makeMatchRpcDetail({ caller_eligibility: 'ranked_members_only' });
    expect(decodeMatchRpcDetail(detail).caller_eligibility).toBe('ranked_members_only');
  });
});

describe('Ranked members-only capability and errors', () => {
  const event = makeMatchCard({
    caller_eligibility: 'ranked_members_only',
    caller_is_invited: true,
    visibility: 'invite_only'
  });

  it('never offers a guest CTA to a nonmember of a Ranked event, even when invited', () => {
    expect(matchRegistrationAction(event, Date.parse('2030-06-01T00:00:00Z'))).toBe(
      'ranked_members_only'
    );
  });

  it('maps the SQL token to a stable code', () => {
    expect(
      matchRegistrationActionError({ message: 'MATCH_REGISTRATION_RANKED_MEMBERS_ONLY' })
    ).toEqual({ status: 'error', code: 'ranked_members_only' });
  });
});

describe('Ranked copy', () => {
  it.each([
    ['en', en],
    ['pt-BR', pt],
    ['es', es]
  ] as const)('ships every new string in %s', (_locale, resource) => {
    const strings = [
      resource.matches.competition.ranked,
      resource.matches.competition.unranked,
      resource.matches.detail.rankedMembersOnly,
      resource.matches.invitations.errors.rankedMembersOnly,
      resource.matchRegistration.feedback.rankedMembersOnly,
      resource.matchCreate.competition.legend,
      resource.matchCreate.competition.league,
      resource.matchCreate.competition.choose,
      resource.matchCreate.competition.members,
      ...Object.values(resource.matchCreate.competition.guidance),
      resource.matchCreate.errors.leagueOptionsUnavailable,
      resource.matchCreate.errors.leagueRequired,
      resource.matchCreate.errors.leagueUnavailable
    ];
    expect(strings.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
  });

  it('translates the competition labels differently from English', () => {
    expect(pt.matches.competition.ranked).not.toBe(en.matches.competition.ranked);
    expect(es.matches.competition.ranked).not.toBe(en.matches.competition.ranked);
  });
});
