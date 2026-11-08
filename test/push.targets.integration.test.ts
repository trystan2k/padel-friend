import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeNotificationTarget } from '../src/features/notifications/notification-target';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { insertLeague, leagueWorld, type LeagueWorld } from './helpers/league-fixtures';
import {
  levelReviewWorld,
  revokePlatformAdmin,
  submitRequest,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';
import { asRecord } from './helpers/match-registration-sql';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const sql = (text: string, values: unknown[] = []) => queryTrustedSql(text, { values });

describe.skipIf(!environment.env)('push recipient-private destinations (real RLS)', () => {
  let leagues: LeagueWorld;
  let reviews: LevelReviewWorld;
  let amendments: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  afterAll(async () => {
    await amendments?.cleanup();
  });
  beforeAll(async () => {
    leagues = await leagueWorld(environment.env!, 'pushtargets');
    reviews = await levelReviewWorld(environment.env!, 'pushtargetreviews');
    amendments = await createResultAmendmentFixtures(environment.env!);
  });
  async function notice(
    recipient: string,
    kind: string,
    category: string,
    type: string,
    target: string,
    community: string | null = null
  ) {
    const result = await sql('select public.persist_notification($1,$2,$3,$4,$5,$6,$7) as id', [
      recipient,
      'push-target:' + crypto.randomUUID(),
      kind,
      category,
      type,
      target,
      community
    ]);
    const id = String(result.rows[0]!.id);
    const foreign = await reviews.other.client.rpc('get_my_notification_target_v4', {
      p_notification_id: id
    });
    expect(foreign.error).not.toBeNull();
    expect(foreign.data).toBeNull();
    return id;
  }
  async function resolve(actor: LeagueWorld['member'], id: string) {
    const result = await actor.client
      .rpc('get_my_notification_target_v4', { p_notification_id: id })
      .single();
    expect(result.error).toBeNull();
    return decodeNotificationTarget(result.data!);
  }
  function unavailable(target: Awaited<ReturnType<typeof resolve>>) {
    expect(target).toMatchObject({
      target_status: 'unavailable',
      community_id: null,
      community_name: null,
      match_event_id: null,

      destination_href: null
    });
    expect(target.result_context ?? null).toBeNull();
    expect(target.level_review_context ?? null).toBeNull();
  }
  it('rating destination is owner-only; foreign account, signed-out and forged target fail safely; GET never marks read', async () => {
    const id = await notice(
      reviews.owner.id,
      'rating_changed',
      'rankings',
      'player_rating',
      reviews.owner.id
    );
    expect(await resolve(reviews.owner, id)).toMatchObject({
      target_status: 'destination_available',
      destination_href: '/players/' + reviews.owner.id
    });
    const foreign = await reviews.other.client.rpc('get_my_notification_target_v4', {
      p_notification_id: id
    });
    expect(foreign.error).not.toBeNull();
    expect(foreign.data).toBeNull();
    const anonymous = createClient(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false }
    });
    expect(
      (await anonymous.rpc('get_my_notification_target_v4', { p_notification_id: id })).error
    ).not.toBeNull();
    unavailable(
      await resolve(
        reviews.owner,
        await notice(
          reviews.owner.id,
          'rating_changed',
          'rankings',
          'player_rating',
          reviews.other.id
        )
      )
    );
    const read = await sql('select read_at from public.notifications where id=$1', [id]);
    expect(read.rows[0]!.read_at).toBeNull();
  });
  it('submission receipt links owner detail; reviewer notice requires current platform role', async () => {
    const requestId = await submitRequest(reviews.owner);
    const notices = await sql(
      'select id,recipient_user_id,kind from public.notifications where target_id=$1',
      [requestId]
    );
    const receipt = notices.rows.find(
      (n) => n.kind === 'level_review_submitted' && n.recipient_user_id === reviews.owner.id
    )!;
    const reviewer = notices.rows.find(
      (n) => n.kind === 'level_review_requested' && n.recipient_user_id === reviews.platformAdmin.id
    )!;
    expect(await resolve(reviews.owner, String(receipt.id))).toMatchObject({
      destination_href: '/level-reviews/' + requestId
    });
    expect(await resolve(reviews.platformAdmin, String(reviewer.id))).toMatchObject({
      destination_href: '/platform-admin/level-reviews/' + requestId
    });
    await revokePlatformAdmin(reviews.platformAdmin.id);
    unavailable(await resolve(reviews.platformAdmin, String(reviewer.id)));
    unavailable(
      await resolve(
        reviews.owner,
        await notice(
          reviews.owner.id,
          'level_review_submitted',
          'rankings',
          'level_review_request',
          crypto.randomUUID()
        )
      )
    );
  });
  it('role notice resolves current membership, then hides names after removal', async () => {
    const member = await sql(
      'select id from public.community_members where community_id=$1 and user_id=$2 and valid_until is null',
      [leagues.communityId, leagues.member.id]
    );
    const id = await notice(
      leagues.member.id,
      'community_role_changed',
      'community',
      'community_membership',
      String(member.rows[0]!.id),
      leagues.communityId
    );
    expect(await resolve(leagues.member, id)).toMatchObject({
      target_status: 'membership_available',
      community_id: leagues.communityId
    });
    await leagues.removeMember(leagues.member);
    unavailable(await resolve(leagues.member, id));
  });
  it('deleted League target stays generic and never exposes stale community context', async () => {
    const leagueId = await insertLeague({
      communityId: leagues.communityId,
      ownerId: leagues.owner.id,
      startAt: '2099-01-01T00:00:00Z'
    });
    const id = await notice(
      leagues.owner.id,
      'league_started',
      'leagues',
      'league',
      leagueId,
      leagues.communityId
    );
    expect(await resolve(leagues.owner, id)).toMatchObject({
      target_status: 'destination_available'
    });
    await sql('delete from public.leagues where id=$1', [leagueId]);
    unavailable(await resolve(leagues.owner, id));
  });
  it.each(['approve', 'reject'] as const)(
    'amendment %s targets preserve historical proposal and current authorization',
    async (decision) => {
      const group = await amendments.confirmedGroup();
      const requested = await amendments.request(amendments.p3, group);
      expect(requested.error).toBeNull();
      const amendmentId = String(asRecord(requested.data).amendment_id);
      const requestNotice = await sql(
        "select id from public.notifications where target_id=$1 and kind='result_amendment_requested' and recipient_user_id=$2",
        [group.eventId, amendments.p0.id]
      );
      const requestTarget = await amendments.p0.client
        .rpc('get_my_notification_target_v4', {
          p_notification_id: String(requestNotice.rows[0]!.id)
        })
        .single();
      expect(requestTarget.error).toBeNull();
      expect(decodeNotificationTarget(requestTarget.data!).result_context).toMatchObject({
        notification_kind: 'result_amendment_requested',
        proposal_id: group.proposalId,
        proposal_version: 1
      });
      const candidate = await amendments.candidate(amendments.p0, group, amendmentId);
      expect(candidate.error).toBeNull();
      const version = Number(asRecord(candidate.data).candidate_version);
      const reviewed = await amendments.review(amendments.p1, group, amendmentId, version, {
        p_decision: decision,
        ...(decision === 'reject' ? { p_reason_code: 'SCORE_INCORRECT' } : {})
      });
      expect(reviewed.error).toBeNull();
      const kind =
        decision === 'approve' ? 'result_amendment_accepted' : 'result_amendment_rejected';
      const notices = await sql(
        'select id from public.notifications where target_id=$1 and kind=$2 and recipient_user_id=$3',
        [group.eventId, kind, amendments.p3.id]
      );
      const result = await amendments.p3.client
        .rpc('get_my_notification_target_v4', { p_notification_id: String(notices.rows[0]!.id) })
        .single();
      expect(result.error).toBeNull();
      expect(decodeNotificationTarget(result.data!).result_context).toMatchObject({
        notification_kind: kind,
        proposal_id: group.proposalId,
        proposal_version: version
      });
    }
  );
  it.each([
    'league_started',
    'league_closed',
    'league_standings_published',
    'league_standings_amended'
  ])('%s uses current membership and closed snapshot authorization', async (kind) => {
    const leagueId = await insertLeague({
      communityId: leagues.communityId,
      ownerId: leagues.owner.id,
      status: 'closed',
      startAt: '2020-01-01T00:00:00Z',
      endAt: '2020-02-01T00:00:00Z'
    });
    const id = await notice(
      leagues.owner.id,
      kind,
      'leagues',
      'league',
      leagueId,
      leagues.communityId
    );
    // A closed League without a snapshot cannot load the detail screen.
    unavailable(await resolve(leagues.owner, id));
    await sql("select public.league_publish_standings($1, $2, null, now(), 'published')", [
      leagueId,
      'closed'
    ]);
    expect(await resolve(leagues.owner, id)).toMatchObject({
      target_status: 'destination_available',
      destination_href: '/community/' + leagues.communityId + '/leagues/' + leagueId
    });
    const revoked = await notice(
      leagues.former.id,
      kind,
      'leagues',
      'league',
      leagueId,
      leagues.communityId
    );
    unavailable(await resolve(leagues.former, revoked));
    unavailable(
      await resolve(
        leagues.owner,
        await notice(
          leagues.owner.id,
          kind,
          'leagues',
          'league',
          crypto.randomUUID(),
          leagues.communityId
        )
      )
    );
  });
});
