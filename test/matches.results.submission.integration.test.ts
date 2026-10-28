import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMatchManagementFixtures,
  type ManagementActor
} from './helpers/match-management-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  proveEventLockBarrier,
  sqlRows
} from './helpers/match-registration-sql';

const sets = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 4, team_b_games: 6, completed: true },
  { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
];
const played = {
  local: '2020-01-01 12:00:00',
  offset_seconds: 0,
  instant: '2020-01-01T12:00:00.000Z'
};

describe('actual result submission transaction', { timeout: 60000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  let other: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  let players: ManagementActor[];
  let admin: ManagementActor;
  let outsider: ManagementActor;
  let reserve: ManagementActor;
  let anon: { token: string };
  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchManagementFixtures(env);
    other = await createMatchManagementFixtures(env);
    players = [f.creator, ...(await Promise.all(Array.from({ length: 7 }, () => f.member())))];
    admin = await f.member();
    outsider = await f.actor();
    reserve = await f.member();
    await fixtureSql(`do $$ begin alter table public.community_members disable trigger community_member_guard;
      update public.community_members set role='admin' where community_id='${f.communityId}' and user_id='${admin.id}';
      alter table public.community_members enable trigger community_member_guard; end $$;`);
    anon = { token: env.key };
  });
  afterAll(async () => {
    if (f) await f.cleanup();
    if (other) await other.cleanup();
  });

  async function setup(
    options: {
      protected?: boolean;
      timezone?: string;
      competitive?: boolean;
      reserve?: boolean;
    } = {}
  ) {
    const e = await f.event({
      accepted: options.reserve ? [...players.slice(1), reserve] : players.slice(1)
    });
    if (options.timezone || options.competitive)
      await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set timezone='${options.timezone ?? 'UTC'}',event_type='${options.competitive ? 'competitive' : 'friendly'}' where id='${e.id}';
      alter table public.match_events enable trigger match_event_immutable; end $$;`);
    await f.setCutoff(e.id, "now()-interval '1 minute'");
    if (options.protected !== false) await f.protectResults(e.id);
    return e;
  }
  function args(id: string, group = 1) {
    const p = players.slice((group - 1) * 4, group * 4).map((player) => player.id);
    return {
      p_match_event_id: id,
      p_group_number: group,
      p_teams: { team_a: p.slice(0, 2), team_b: p.slice(2) },
      p_sets: sets,
      p_played_local: played,
      p_court_label: ' Court 3 ',
      p_request_id: crypto.randomUUID()
    };
  }
  async function facts(id: string) {
    return sqlRows(`select to_jsonb(s) state,
      (select count(*) from public.match_event_result_proposals where match_event_id=s.match_event_id) proposals,
      (select count(*) from public.match_event_result_proposal_versions v join public.match_event_result_proposals p on p.id=v.proposal_id where p.match_event_id=s.match_event_id) versions,
      (select count(*) from public.match_event_management_commands where match_event_id=s.match_event_id) commands
      from public.match_event_registration_state s where match_event_id='${id}'`);
  }
  async function read(id: string, actor = f.creator) {
    const result = await f.rpc(actor, 'get_match_event_result_proposals', { p_match_event_id: id });
    expect(result.error).toBeNull();
    if (!Array.isArray(result.data)) throw new Error('INVALID_RESULT_PROJECTION');
    return result.data.map(asRecord);
  }
  it('projects team identities to creator and same-community admin only', async () => {
    const e = await setup();
    for (const actor of [f.creator, admin]) {
      const response = await f.rpc(actor, 'list_match_event_management_participants', {
        p_match_event_id: e.id
      });
      expect(response.error).toBeNull();
      expect(response.data).toHaveLength(8);
      expect(response.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ user_id: players[0]!.id })])
      );
    }
    for (const actor of [players[1]!, outsider, other.creator]) {
      const response = await f.rpc(actor, 'list_match_event_management_participants', {
        p_match_event_id: e.id
      });
      expect(response.error).toBeNull();
      expect(response.data).toEqual([]);
    }
  });
  it('creator submits pending proposal for group one and roster freezes exactly once', async () => {
    const e = await setup({ protected: false });
    const input = args(e.id);
    expect((await facts(e.id))[0]?.state).toMatchObject({
      results_protected_at: null,
      cutoff_processed_at: null
    });
    const result = await f.rpc(f.creator, 'submit_match_event_result', input);
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ version: 1, group_number: 1, replayed: false });
    const after = await facts(e.id);
    expect(after[0]?.state).toMatchObject({
      results_protected_at: expect.any(String),
      cutoff_processed_at: expect.any(String)
    });
    expect((await f.rpc(f.creator, 'submit_match_event_result', input)).data).toMatchObject({
      replayed: true
    });
    await f.protectResults(e.id);
    expect(await facts(e.id)).toEqual(after);
    expect(
      await sqlRows(`select p.submitted_by::text as pointer_submitter,
        v.submitted_by::text as version_submitter,
        p.submitted_at = v.submitted_at as submitted_at_matches,
        p.review_deadline_at = v.review_deadline_at as deadline_matches,
        p.review_deadline_at = p.submitted_at + interval '48 hours' as exact_48_hours
        from public.match_event_result_proposals p
        join public.match_event_result_proposal_versions v
          on v.proposal_id = p.id and v.version = p.active_version
        where p.match_event_id = '${e.id}'`)
    ).toEqual([
      {
        pointer_submitter: f.creator.id,
        version_submitter: f.creator.id,
        submitted_at_matches: true,
        deadline_matches: true,
        exact_48_hours: true
      }
    ]);
    expect(await read(e.id)).toHaveLength(1);
    expect(
      (
        await f.rpc(f.creator, 'edit_match_event', {
          p_match_event_id: e.id,
          p_expected_version: 1,
          p_patch: { notes: 'No' },
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_RESULT_PROTECTED');
  });
  it('post-match explicit team swap is stored as submitted', async () => {
    const e = await setup();
    const input = args(e.id);
    input.p_teams = {
      team_a: [players[0]!.id, players[2]!.id],
      team_b: [players[1]!.id, players[3]!.id]
    };
    expect((await f.rpc(f.creator, 'submit_match_event_result', input)).error).toBeNull();
    const rows = await sqlRows(
      `select v.teams from public.match_event_result_proposal_versions v join public.match_event_result_proposals p on p.id=v.proposal_id where p.match_event_id='${e.id}'`
    );
    expect(rows).toEqual([{ teams: input.p_teams }]);
  });
  it('duplicate player across submitted teams is rejected', async () => {
    const e = await setup({ protected: false });
    const input = args(e.id);
    input.p_teams.team_b[0] = players[0]!.id;
    const before = await facts(e.id);
    const result = await f.rpc(f.creator, 'submit_match_event_result', input);
    expect(result.error?.message).toBe('MATCH_RESULT_DUPLICATE_PLAYER');
    expect(JSON.parse(result.error!.details!)).toEqual({
      set_index: null,
      side: 'team_b',
      reason_token: 'DUPLICATE_PLAYER'
    });
    expect(await facts(e.id)).toEqual(before);
  });
  it('reserve not playing cannot be included', async () => {
    // Ninth accepted member is outside both complete playing quartets.
    const e = await setup({ reserve: true });
    expect(
      await sqlRows(
        `select participation_status from public.match_event_registrations where match_event_id='${e.id}' and user_id='${reserve.id}'`
      )
    ).toEqual([{ participation_status: 'reserve_not_playing' }]);
    const input = args(e.id);
    input.p_teams.team_b[1] = reserve.id;
    expect((await f.rpc(f.creator, 'submit_match_event_result', input)).error?.message).toBe(
      'MATCH_RESULT_GROUP_PLAYERS'
    );
  });
  it('submitted players must equal the group quartet exactly', async () => {
    const e = await setup();
    const wrong = args(e.id, 2);
    wrong.p_group_number = 1;
    expect((await f.rpc(f.creator, 'submit_match_event_result', wrong)).error?.message).toBe(
      'MATCH_RESULT_GROUP_PLAYERS'
    );
    expect(
      (await f.rpc(f.creator, 'submit_match_event_result', { ...args(e.id), p_group_number: 3 }))
        .error?.message
    ).toBe('MATCH_RESULT_INVALID_GROUP');
  });
  it('SQL independently rejects malformed request teams played-at court and score without writes', async () => {
    const e = await setup({ protected: false });
    const input = args(e.id);
    const before = await facts(e.id);
    const invalid: [Record<string, unknown>, string][] = [
      [{ p_request_id: null }, 'INVALID_REQUEST'],
      [{ p_group_number: 0 }, 'INVALID_REQUEST'],
      [{ p_teams: { ...input.p_teams, extra: [] } }, 'INVALID_TEAMS'],
      [
        { p_teams: { team_a: input.p_teams.team_a, team_b: ['not-a-uuid', players[3]!.id] } },
        'INVALID_TEAMS'
      ],
      [{ p_teams: { team_a: input.p_teams.team_a, team_b: null } }, 'INVALID_TEAMS'],
      [{ p_court_label: ' ' }, 'INVALID_COURT'],
      [{ p_court_label: 'Court\n3' }, 'INVALID_COURT'],
      [{ p_court_label: 'x'.repeat(101) }, 'INVALID_COURT'],
      [
        { p_sets: [{ position: 1, team_a_games: 6, team_b_games: 5, completed: true }] },
        'INVALID_SET_SCORE'
      ],
      [{ p_played_local: { ...played, extra: true } }, 'INVALID_PLAYED_AT'],
      [{ p_played_local: { ...played, offset_seconds: 1 } }, 'INVALID_PLAYED_AT'],
      [{ p_played_local: { ...played, offset_seconds: 50460 } }, 'INVALID_PLAYED_AT'],
      [{ p_played_local: { ...played, local: '2020-02-30 12:00:00' } }, 'INVALID_PLAYED_AT']
    ];
    for (const [patch, token] of invalid) {
      const result = await f.rpc(f.creator, 'submit_match_event_result', { ...input, ...patch });
      expect(result.error?.message).toBe(`MATCH_RESULT_${token}`);
      expect(await facts(e.id)).toEqual(before);
    }
    expect(
      (
        await f.rpc(f.creator, 'submit_match_event_result', {
          ...input,
          p_match_event_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_RESULT_NOT_FOUND');
  });
  it('played_at community-timezone boundary validation', async () => {
    const cases = [
      {
        timezone: 'Asia/Tokyo',
        local: '2020-01-02 00:30:00',
        offset: 32400,
        instant: '2020-01-01T15:30:00Z',
        token: null
      },
      {
        timezone: 'America/New_York',
        local: '2020-03-08 02:30:00',
        offset: -18000,
        instant: '2020-03-08T07:30:00Z',
        token: 'MATCH_RESULT_INVALID_PLAYED_AT'
      },
      {
        timezone: 'America/New_York',
        local: '2020-11-01 01:30:00',
        offset: -14400,
        instant: '2020-11-01T05:30:00Z',
        token: null
      },
      {
        timezone: 'America/New_York',
        local: '2020-11-01 01:30:00',
        offset: -18000,
        instant: '2020-11-01T06:30:00Z',
        token: null
      },
      {
        timezone: 'UTC',
        local: '2099-01-01 12:00:00',
        offset: 0,
        instant: '2099-01-01T12:00:00Z',
        token: 'MATCH_RESULT_FUTURE_PLAYED_AT'
      },
      {
        timezone: 'UTC',
        local: played.local,
        offset: 3600,
        instant: played.instant,
        token: 'MATCH_RESULT_INVALID_PLAYED_AT'
      }
    ];
    for (const c of cases) {
      const e = await setup({ timezone: c.timezone });
      const result = await f.rpc(f.creator, 'submit_match_event_result', {
        ...args(e.id),
        p_played_local: { local: c.local, offset_seconds: c.offset, instant: c.instant }
      });
      expect({ fixture: c, token: result.error?.message ?? null }).toEqual({
        fixture: c,
        token: c.token
      });
      const stored = c.token ? null : (await read(e.id))[0];
      expect(
        stored && {
          played_at_local: stored.played_at_local,
          played_at_offset_seconds: stored.played_at_offset_seconds
        }
      ).toEqual(c.token ? null : { played_at_local: c.local, played_at_offset_seconds: c.offset });
    }
    const e = await setup({ timezone: 'America/New_York' });
    expect(
      (
        await f.rpc(f.creator, 'submit_match_event_result', {
          ...args(e.id),
          p_played_local: { local: '2020-11-01 01:30:00', instant: '2020-11-01T05:30:00Z' }
        })
      ).error?.message
    ).toBe('MATCH_RESULT_INVALID_PLAYED_AT');
  });
  it('played_at is preserved independently of schedule submission and confirmation clocks', async () => {
    const e = await setup();
    expect((await f.rpc(f.creator, 'submit_match_event_result', args(e.id))).error).toBeNull();
    const [p] = await read(e.id);
    const [event] = await sqlRows(`select starts_at from public.match_events where id='${e.id}'`);
    expect(p?.played_at_local).toBe(played.local);
    expect(Date.parse(String(p?.played_at_utc))).toBe(Date.parse(played.instant));
    expect(
      new Set([
        Date.parse(String(event?.starts_at)),
        Date.parse(String(p?.played_at_utc)),
        Date.parse(String(p?.submitted_at)),
        Date.parse(String(p?.review_deadline_at))
      ]).size
    ).toBe(4);
    expect(Date.parse(String(p?.review_deadline_at)) - Date.parse(String(p?.submitted_at))).toBe(
      48 * 3600000
    );
    expect(p?.court_label).toBe('Court 3');
  });
  it('second stale submission cannot replace active proposal', async () => {
    const e = await setup();
    const first = await f.rpc(f.creator, 'submit_match_event_result', args(e.id));
    expect(first.error).toBeNull();
    const before = await facts(e.id);
    const second = await f.rpc(admin, 'submit_match_event_result', args(e.id));
    expect(second.error?.message).toBe('MATCH_RESULT_ACTIVE_PROPOSAL');
    expect(JSON.parse(second.error!.details!)).toEqual({
      active_version: 1,
      review_deadline_at: asRecord(first.data).review_deadline_at
    });
    expect(await facts(e.id)).toEqual(before);
    expect(before[0]).toMatchObject({ proposals: 1, versions: 1 });
  });
  it('proposal racing another editor has one winner', async () => {
    const e = await setup({ protected: false });
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'submit_match_event_result',
      fire: () => [
        f.rpc(f.creator, 'submit_match_event_result', args(e.id)),
        f.rpc(admin, 'submit_match_event_result', args(e.id))
      ]
    });
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe('MATCH_RESULT_ACTIVE_PROPOSAL');
    expect((await facts(e.id))[0]).toMatchObject({ proposals: 1, versions: 1, commands: 1 });
  });
  it('admin recovery allows same-community admin and creator only', async () => {
    const e = await setup();
    for (const actor of [other.creator, players[1]!, outsider, anon]) {
      const r = await f.rpc(actor, 'submit_match_event_result', args(e.id));
      expect(r.error).not.toBeNull();
      expect(actor === anon || r.error?.message === 'MATCH_RESULT_FORBIDDEN').toBe(true);
    }
    expect((await f.rpc(admin, 'submit_match_event_result', args(e.id))).error).toBeNull();
    await expect(
      fixtureSql(`do $$ begin set local role authenticated;
      perform set_config('request.jwt.claims','{"sub":"${f.creator.id}","is_anonymous":true}',true);
      perform public.submit_match_event_result('${e.id}',1,'{}','[]','{}',null,'${crypto.randomUUID()}'); end $$;`)
    ).rejects.toThrow('MATCH_RESULT_UNAUTHENTICATED');
    expect((await f.rpc(f.creator, 'submit_match_event_result', args(e.id, 2))).error).toBeNull();
    for (const actor of [admin, f.creator])
      expect(
        asRecord(
          (await f.rpc(actor, 'get_match_event_management', { p_match_event_id: e.id })).data
        ).correction
      ).toEqual({ available: true, target: 'record_result', event_id: e.id });
    const cancelled = await f.event({ accepted: players.slice(1) });
    expect(
      (
        await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: cancelled.id,
          p_reason: 'Weather',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      (await f.rpc(f.creator, 'submit_match_event_result', args(cancelled.id))).error?.message
    ).toBe('MATCH_RESULT_CANCELLED');
  });
  it('creator not in group can submit', async () => {
    const e = await setup();
    expect((await f.rpc(f.creator, 'submit_match_event_result', args(e.id, 2))).error).toBeNull();
    expect((await read(e.id))[0]?.group_number).toBe(2);
  });
  it('friendly result writes nothing outside proposal tables', async () => {
    const e = await setup();
    const snapshot = () =>
      sqlRows(`select
      (select count(*) from public.player_profiles) profiles,
      (select count(*) from public.global_player_ratings) ratings,
      (select jsonb_agg(to_jsonb(p) order by user_id) from public.player_profiles p) profile_facts,
      (select jsonb_agg(to_jsonb(g) order by user_id) from public.global_player_ratings g) rating_facts,
      (select count(*) from public.communities) communities,
      (select count(*) from public.community_members) members,
      (select count(*) from public.community_audit_log) community_audit,
      (select count(*) from public.notifications where target_id='${e.id}') notifications,
      (select jsonb_agg(to_jsonb(r) order by id) from public.match_event_registrations r where match_event_id='${e.id}') roster`);
    const before = await snapshot();
    expect((await f.rpc(f.creator, 'submit_match_event_result', args(e.id))).error).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect((await read(e.id))[0]?.rating_effective).toBe(false);
  });
  it('command replay returns original submission without effects', async () => {
    const e = await setup();
    const input = args(e.id);
    const result = await f.rpc(f.creator, 'submit_match_event_result', input);
    expect(result.error).toBeNull();
    const before = await facts(e.id);
    const replay = await f.rpc(f.creator, 'submit_match_event_result', input);
    expect(replay.data).toEqual({ ...asRecord(result.data), replayed: true });
    expect(
      (
        await f.rpc(f.creator, 'submit_match_event_result', {
          ...input,
          p_court_label: 'Different'
        })
      ).error?.message
    ).toBe('MATCH_RESULT_IDEMPOTENCY_CONFLICT');
    expect(await facts(e.id)).toEqual(before);
  });
  it('read RPC exposes version deadline and rating_effective to authorized viewers only', async () => {
    const e = await setup({ competitive: true });
    expect((await f.rpc(f.creator, 'submit_match_event_result', args(e.id))).error).toBeNull();
    const expected = await read(e.id);
    expect(expected[0]).toMatchObject({
      version: 1,
      status: 'pending',
      classification: 'draw',
      rating_effective: true,
      submitted_by_name: null,
      review_deadline_at: expect.any(String),
      teams: {
        team_a: [
          { user_id: players[0]!.id, display_name: null },
          { user_id: players[1]!.id, display_name: null }
        ]
      }
    });
    expect(await read(e.id, admin)).toEqual(expected);
    const sameGroupPlayerRead = await read(e.id, players[1]);
    expect(sameGroupPlayerRead[0]).toMatchObject({
      can_approve: false,
      can_reject: true,
      can_correct: false
    });
    expect({
      ...sameGroupPlayerRead[0],
      can_approve: expected[0]!.can_approve,
      can_reject: expected[0]!.can_reject,
      can_correct: expected[0]!.can_correct
    }).toEqual(expected[0]);
    for (const actor of [other.creator, outsider, anon])
      expect(
        (await f.rpc(actor, 'get_match_event_result_proposals', { p_match_event_id: e.id })).error
      ).not.toBeNull();
    await expect(
      fixtureSql(`do $$ begin set local role authenticated;
      perform set_config('request.jwt.claims','{"sub":"${f.creator.id}","is_anonymous":true}',true);
      perform public.get_match_event_result_proposals('${e.id}'); end $$;`)
    ).rejects.toThrow('MATCH_RESULT_UNAUTHENTICATED');
    expect(
      (
        await f.rpc(f.creator, 'submit_match_event_result', {
          ...args(e.id, 2),
          p_sets: sets.slice(0, 1)
        })
      ).error
    ).toBeNull();
    expect((await read(e.id))[1]).toMatchObject({
      classification: 'incomplete',
      rating_effective: false
    });
  });
});
