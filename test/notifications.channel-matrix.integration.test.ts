import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CHANNEL_MATRIX,
  NOTIFICATION_CHANNEL_MATRIX_VERSION
} from './fixtures/notification-channel-matrix';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { insertLeague, leagueWorld, type LeagueWorld } from './helpers/league-fixtures';
import {
  levelReviewWorld,
  submitRequest,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import {
  confirmedGroup,
  nextTailPlayedAt,
  ratingWorld,
  toQuartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';
import { asRecord } from './helpers/match-registration-sql';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const rows = async (sql: string, values: unknown[] = []) =>
  (await queryTrustedSql(sql, { values })).rows;
async function channels(kind: string, target: string, expected: readonly string[]) {
  const actual = await rows(
    `select n.recipient_user_id::text as recipient,n.id,j.notification_id from public.notifications n left join public.notification_push_jobs j on j.notification_id=n.id where n.kind=$1 and n.target_id=$2 order by n.recipient_user_id`,
    [kind, target]
  );
  expect(actual.map((row) => row.recipient)).toEqual([...expected].sort());
  for (const row of actual) expect(row.notification_id).toBe(row.id);
}

describe.skipIf(!environment.env)(
  'AC3 added producer domain transitions and channel identity',
  { timeout: 180000 },
  () => {
    let leagues: LeagueWorld;
    let reviews: LevelReviewWorld;
    let ratings: RatingWorld;
    let amendments: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
    beforeAll(async () => {
      leagues = await leagueWorld(environment.env!, 'pushmatrix');
      reviews = await levelReviewWorld(environment.env!, 'pushreview');
      ratings = await ratingWorld(environment.env!, 'pushrating');
      amendments = await createResultAmendmentFixtures(environment.env!);
    });
    afterAll(async () => {
      await amendments?.cleanup();
    });

    it('versioned matrix names installed production seams, distinct transitions and real proof files', async () => {
      expect(NOTIFICATION_CHANNEL_MATRIX_VERSION).toBe(1);
      expect(new Set(NOTIFICATION_CHANNEL_MATRIX.map((row) => row.event)).size).toBe(
        NOTIFICATION_CHANNEL_MATRIX.length
      );
      for (const row of NOTIFICATION_CHANNEL_MATRIX) {
        expect(existsSync(row.proof)).toBe(true);
        expect(
          await rows(
            `select 1 from pg_proc where pronamespace='public'::regnamespace and proname=$1 limit 1`,
            [row.seam]
          )
        ).toHaveLength(1);
      }
    });

    it('role promotion notifies only changed member; repeated no-op emits nothing', async () => {
      const [member] = await rows(
        `select id::text from public.community_members where community_id=$1 and user_id=$2 and valid_until is null`,
        [leagues.communityId, leagues.member.id]
      );
      expect(
        (
          await leagues.admin.client.rpc('govern_community_member', {
            p_community_id: leagues.communityId,
            p_membership_id: String(member!.id),
            p_action: 'promote'
          })
        ).error
      ).toBeNull();
      await channels('community_role_changed', String(member!.id), [leagues.member.id]);
      expect(
        (
          await leagues.admin.client.rpc('govern_community_member', {
            p_community_id: leagues.communityId,
            p_membership_id: String(member!.id),
            p_action: 'promote'
          })
        ).error
      ).not.toBeNull();
      await channels('community_role_changed', String(member!.id), [leagues.member.id]);
    });
    it('role demotion uses next immutable member revision, independent of deleted alerts', async () => {
      const [member] = await rows(
        `select id::text from public.community_members where community_id=$1 and user_id=$2 and valid_until is null`,
        [leagues.communityId, leagues.member.id]
      );
      await executeTrustedSql(
        `delete from public.notifications where target_id='${String(member!.id)}' and kind='community_role_changed'`
      );
      expect(
        (
          await leagues.admin.client.rpc('govern_community_member', {
            p_community_id: leagues.communityId,
            p_membership_id: String(member!.id),
            p_action: 'demote'
          })
        ).error
      ).toBeNull();
      await channels('community_role_changed', String(member!.id), [leagues.member.id]);
      expect(
        (
          await rows(
            `select event_key from public.notifications where target_id=$1 and kind='community_role_changed'`,
            [member!.id]
          )
        )[0]!.event_key
      ).toBe(`community.role_changed:${String(member!.id)}:2`);
    });
    it('concurrent role commands serialize one semantic transition and one job', async () => {
      const [member] = await rows(
        `select id::text from public.community_members where community_id=$1 and user_id=$2 and valid_until is null`,
        [leagues.communityId, leagues.member.id]
      );
      const command = () =>
        leagues.admin.client.rpc('govern_community_member', {
          p_community_id: leagues.communityId,
          p_membership_id: String(member!.id),
          p_action: 'promote'
        });
      const results = await Promise.all([command(), command()]);
      expect(results.filter((result) => !result.error)).toHaveLength(1);
      const alerts = await rows(
        `select n.recipient_user_id::text,n.event_key,j.notification_id from public.notifications n join public.notification_push_jobs j on j.notification_id=n.id where n.target_id=$1 and n.kind='community_role_changed' order by event_key`,
        [member!.id]
      );
      expect(alerts.map((row) => row.recipient_user_id)).toEqual([
        leagues.member.id,
        leagues.member.id
      ]);
      expect(alerts.map((row) => row.event_key)).toEqual([
        `community.role_changed:${String(member!.id)}:2`,
        `community.role_changed:${String(member!.id)}:3`
      ]);
    });

    it('administration transfer announces every role actually changed, including former administrator', async () => {
      const memberships = await rows(
        `select id::text,user_id::text from public.community_members where community_id=$1 and user_id=any($2::uuid[]) and valid_until is null`,
        [leagues.communityId, [leagues.admin.id, leagues.owner.id]]
      );
      const owner = memberships.find((row) => row.user_id === leagues.owner.id)!;
      const admin = memberships.find((row) => row.user_id === leagues.admin.id)!;
      expect(
        (
          await leagues.admin.client.rpc('govern_community_member', {
            p_community_id: leagues.communityId,
            p_membership_id: String(owner.id),
            p_action: 'promote'
          })
        ).error
      ).toBeNull();
      expect(
        (
          await leagues.owner.client.rpc('govern_community_member', {
            p_community_id: leagues.communityId,
            p_membership_id: String(admin.id),
            p_action: 'demote'
          })
        ).error
      ).toBeNull();
      await channels('community_role_changed', String(owner.id), [leagues.owner.id]);
      await channels('community_role_changed', String(admin.id), [leagues.admin.id]);
    });
    it('League scheduled start includes authorized actor/member only; replay has no new alert', async () => {
      expect.hasAssertions();
      const id = await insertLeague({
        communityId: leagues.communityId,
        ownerId: leagues.owner.id,
        startAt: new Date(Date.now() - 60000).toISOString(),
        endAt: null
      });
      await executeTrustedSql(
        `select public.league_process_community_locked('${leagues.communityId}',now())`
      );
      const expected = [leagues.admin.id, leagues.owner.id, leagues.member.id];
      await channels('league_started', id, expected);
      await executeTrustedSql(
        `select public.league_process_community_locked('${leagues.communityId}',now())`
      );
      await channels('league_started', id, expected);
    });
    it('League close and first snapshot are separate events with exact authorized audience and replay identity', async () => {
      const [league] = await rows(
        `select id::text,version from public.leagues where community_id=$1 and status='active'`,
        [leagues.communityId]
      );
      const id = String(league!.id);
      const close = () =>
        leagues.owner.client.rpc('close_league', {
          p_league_id: id,
          p_expected_version: Number(league!.version)
        });
      expect((await close()).error).toBeNull();
      const expected = [leagues.admin.id, leagues.owner.id, leagues.member.id];
      await channels('league_closed', id, expected);
      await channels('league_standings_published', id, expected);
      expect((await close()).error).toBeNull();
      await channels('league_closed', id, expected);
      await channels('league_standings_published', id, expected);
      expect(
        (
          await rows(
            `select distinct event_key from public.notifications where target_id=$1 and kind='league_standings_published'`,
            [id]
          )
        )[0]!.event_key
      ).toBe(`league.standings:${id}:v1`);
    });
    it('scheduled expiry before League activation still announces close and its readable final snapshot', async () => {
      const id = await insertLeague({
        communityId: leagues.communityId,
        ownerId: leagues.owner.id,
        startAt: new Date(Date.now() - 172800000).toISOString(),
        endAt: new Date(Date.now() - 86400000).toISOString()
      });
      await executeTrustedSql(
        `select public.league_process_community_locked('${leagues.communityId}',now())`
      );
      const expected = [leagues.admin.id, leagues.owner.id, leagues.member.id];
      await expect(channels('league_closed', id, expected)).resolves.toBeUndefined();
      await expect(channels('league_standings_published', id, expected)).resolves.toBeUndefined();
      await channels('league_started', id, []);
      await executeTrustedSql(
        `select public.league_process_community_locked('${leagues.communityId}',now())`
      );
      await channels('league_closed', id, expected);
    });

    it('level review submission receipt and actionable platform-review audience use exact current permission set', async () => {
      expect.hasAssertions();
      const id = await submitRequest(reviews.owner);
      await channels('level_review_submitted', id, [reviews.owner.id]);
      const admins = await rows(
        `select a.user_id::text from public.platform_admins a left join public.player_profiles p on p.user_id=a.user_id join auth.users u on u.id=a.user_id where not coalesce(p.is_provisional,false) and not coalesce(u.is_anonymous,false) and a.user_id<>$1`,
        [reviews.owner.id]
      );
      await channels(
        'level_review_requested',
        id,
        admins.map((row) => String(row.user_id))
      );
    });
    it('committed rating publication combines visible level/reliability; replay never publishes intermediate calculations', async () => {
      const players = await Promise.all(
        [3, 3, 5, 5].map((level, i) => ratings.player(`push${i}`, level))
      );
      const ids = players.map((p) => p.id);
      const before = await rows(
        `select user_id::text,display_level,reliability_percent from public.global_player_ratings where user_id=any($1::uuid[])`,
        [ids]
      );
      const group = await confirmedGroup({
        eventId: await ratings.newEvent(),
        players: toQuartet(ids),
        playedAt: await nextTailPlayedAt(),
        submittedBy: ratings.admin.id,
        classification: 'team_a'
      });
      const after = await rows(
        `select user_id::text,display_level,reliability_percent from public.global_player_ratings where user_id=any($1::uuid[])`,
        [ids]
      );
      const changed = after
        .filter((row) => {
          const old = before.find((p) => p.user_id === row.user_id)!;
          return (
            row.display_level !== old.display_level ||
            row.reliability_percent !== old.reliability_percent
          );
        })
        .map((row) => String(row.user_id))
        .sort();
      expect(changed.length).toBeGreaterThan(0);
      for (const id of ids) await channels('rating_changed', id, changed.includes(id) ? [id] : []);
      const fingerprint = await rows(
        `select id,event_key from public.notifications where recipient_user_id=any($1::uuid[]) and kind='rating_changed' order by id`,
        [ids]
      );
      await executeTrustedSql(
        `select public.project_confirmed_rating_group('${group.proposalId}')`
      );
      expect(
        await rows(
          `select id,event_key from public.notifications where recipient_user_id=any($1::uuid[]) and kind='rating_changed' order by id`,
          [ids]
        )
      ).toEqual(fingerprint);
    });
    it.each(['level_only', 'reliability_only'] as const)(
      'visible rating publication %s follows actual confirmed results',
      async (variant) => {
        const players = await Promise.all(
          [0, 1, 2, 3].map((i) => ratings.player(`${variant}${i}`, 4))
        );
        const ids = players.map((player) => player.id);
        const play = async (classification: 'team_a' | 'team_b' | 'draw') =>
          confirmedGroup({
            eventId: await ratings.newEvent(),
            players: toQuartet(ids),
            playedAt: await nextTailPlayedAt(),
            submittedBy: ratings.admin.id,
            classification
          });
        if (variant === 'level_only')
          for (let i = 0; i < 15; i++) await play(i % 2 === 0 ? 'team_a' : 'team_b');
        const before = await rows(
          `select user_id::text,display_level,reliability_percent from public.global_player_ratings where user_id=any($1::uuid[])`,
          [ids]
        );
        const previous = await rows(
          `select id::text from public.notifications where kind='rating_changed' and recipient_user_id=any($1::uuid[])`,
          [ids]
        );
        await play(variant === 'level_only' ? 'team_a' : 'draw');
        const after = await rows(
          `select user_id::text,display_level,reliability_percent from public.global_player_ratings where user_id=any($1::uuid[])`,
          [ids]
        );
        for (const state of after) {
          const old = before.find((row) => row.user_id === state.user_id)!;
          const unchanged = variant === 'level_only' ? 'reliability_percent' : 'display_level';
          expect(state[unchanged]).toBe(old[unchanged]);
        }
        const expected = after
          .filter((state) => {
            const old = before.find((row) => row.user_id === state.user_id)!;
            return (
              state.display_level !== old.display_level ||
              state.reliability_percent !== old.reliability_percent
            );
          })
          .map((state) => String(state.user_id))
          .sort();
        expect(expected.length).toBeGreaterThan(0);
        const notices = await rows(
          `select n.recipient_user_id::text as recipient,n.id,j.notification_id from public.notifications n join public.notification_push_jobs j on j.notification_id=n.id where n.kind='rating_changed' and n.recipient_user_id=any($1::uuid[]) and not(n.id=any($2::uuid[])) order by n.recipient_user_id`,
          [ids, previous.map((row) => row.id)]
        );
        expect(notices.map((row) => row.recipient)).toEqual(expected);
        for (const notice of notices) expect(notice.notification_id).toBe(notice.id);
      }
    );

    it('amendment request alerts only decision makers, retries dedupe', async () => {
      const group = await amendments.confirmedGroup();
      const command = crypto.randomUUID();
      expect(
        (await amendments.request(amendments.p2, group, { p_command_id: command })).error
      ).toBeNull();
      expect(
        (await amendments.request(amendments.p2, group, { p_command_id: command })).error
      ).toBeNull();
      await channels('result_amendment_requested', group.eventId, [
        amendments.p0.id,
        amendments.admin.id
      ]);
    });
    it.each(['approve', 'reject'] as const)(
      'amendment %s decision notifies requester without actor/outsider fanout',
      async (decision) => {
        const group = await amendments.confirmedGroup();
        const requested = await amendments.request(amendments.p3, group);
        expect(requested.error).toBeNull();
        const data = asRecord(requested.data);
        const candidate = await amendments.candidate(
          amendments.p0,
          group,
          String(data.amendment_id)
        );
        expect(candidate.error).toBeNull();
        const version = Number(asRecord(candidate.data).candidate_version);
        const result = await amendments.review(
          amendments.p1,
          group,
          String(data.amendment_id),
          version,
          {
            p_decision: decision,
            ...(decision === 'reject' ? { p_reason_code: 'SCORE_INCORRECT' } : {})
          }
        );
        expect(result.error).toBeNull();
        await channels(
          decision === 'approve' ? 'result_amendment_accepted' : 'result_amendment_rejected',
          group.eventId,
          [amendments.p3.id]
        );
      }
    );
    it('amendment deadline auto-accept alerts requester once through actual processor', async () => {
      const group = await amendments.confirmedGroup();
      const requested = await amendments.request(amendments.p3, group);
      expect(requested.error).toBeNull();
      const amendmentId = String(asRecord(requested.data).amendment_id);
      const candidate = await amendments.candidate(amendments.p0, group, amendmentId);
      expect(candidate.error).toBeNull();
      const version = Number(asRecord(candidate.data).candidate_version);
      await amendments.expireCandidate(group.proposalId, version);
      await executeTrustedSql('select public.process_due_result_amendments(25)');
      await channels('result_amendment_accepted', group.eventId, [amendments.p3.id]);
      await executeTrustedSql('select public.process_due_result_amendments(25)');
      await channels('result_amendment_accepted', group.eventId, [amendments.p3.id]);
    });
    it('late standings publication keys immutable snapshot identity, not mutable live standings or reads', async () => {
      const kit = await createRankedResultFixtures(environment.env!);
      try {
        const leagueId = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
        const eventId = await kit.event(leagueId);
        const submitted = await kit.submit(eventId, playedAt(120).played);
        expect(submitted.error).toBeNull();
        const proposalId = String(asRecord(submitted.data).proposal_id);
        expect(
          (
            await kit.rpc(kit.creator, 'close_league', {
              p_league_id: leagueId,
              p_expected_version: 1
            })
          ).error
        ).toBeNull();
        const expected = [...kit.players.map((p) => p.id)];
        await channels('league_standings_published', leagueId, expected);
        expect((await kit.approve(proposalId, 1, kit.players[2])).error).toBeNull();
        await channels('league_standings_amended', leagueId, expected);
        const keys = await rows(
          `select distinct event_key from public.notifications where target_id=$1 and kind='league_standings_amended'`,
          [leagueId]
        );
        expect(keys).toEqual([{ event_key: `league.standings:${leagueId}:v2` }]);
        expect(
          (await kit.rpc(kit.creator, 'get_league_standings', { p_league_id: leagueId })).error
        ).toBeNull();
        await channels('league_standings_amended', leagueId, expected);
      } finally {
        await kit.cleanup();
      }
    });
  }
);
