import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  countWithdrawn,
  eraseAccount,
  erasurePlan,
  executeErasure,
  approvedPlan,
  scalar,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  ensureProvisionalMembership,
  insertAcceptedRegistration,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText,
  type ProvisionalFixtureActor
} from './helpers/provisional-player-fixtures';
import { insertLeague } from './helpers/league-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

type Ownership = {
  owner: ProvisionalFixtureActor;
  admin: ProvisionalFixtureActor;
  member: ProvisionalFixtureActor;
  communityId: string;
  eventId: string;
  leagueId: string;
};

async function ownershipWorld(label: string): Promise<Ownership> {
  const env = environment.env!;
  const onboard = (name: string) => ({ displayName: (name + ' ' + label).slice(0, 40), level: 4 });
  const owner = await signUpFixtureActor(env, label + '-owner', onboard('Owner'));
  const admin = await signUpFixtureActor(env, label + '-admin', onboard('Admin'));
  const member = await signUpFixtureActor(env, label + '-member', onboard('Member'));
  const communityId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'public',
    adminId: owner.id,
    memberIds: [admin.id, member.id]
  });
  await fixtureSql(
    "update public.community_members set role = 'admin' where community_id = " +
      L(communityId) +
      ' and user_id = ' +
      L(admin.id) +
      ';'
  );
  const eventId = crypto.randomUUID();
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  await insertAcceptedRegistration(eventId, admin.id);
  const leagueId = await insertLeague({
    communityId,
    ownerId: owner.id,
    status: 'upcoming',
    startAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 9 * 86_400_000).toISOString()
  });
  return { owner, admin, member, communityId, eventId, leagueId };
}

const row = async (sql: string) => (await sqlRows(sql))[0]!;

describe.skipIf(!environment.env)(
  'Account erasure ownership and account states',
  { timeout: 600_000 },
  () => {
    it('transfers community, league and match to consenting successors', async () => {
      const w = await ownershipWorld('transfer');
      const successors = {
        communities: { [w.communityId]: w.admin.id },
        leagues: { [w.leagueId]: w.admin.id },
        matches: { [w.eventId]: w.admin.id }
      };
      await eraseAccount(w.owner.id, successors);

      expect(
        (
          await row(
            'select created_by::text as v, archived_at from public.communities where id = ' +
              L(w.communityId)
          )
        )['v']
      ).toBe(w.admin.id);
      expect(
        (await row('select archived_at from public.communities where id = ' + L(w.communityId)))[
          'archived_at'
        ]
      ).toBeNull();
      expect(
        (
          await row(
            'select owner_id::text as v, status::text as s from public.leagues where id = ' +
              L(w.leagueId)
          )
        )['v']
      ).toBe(w.admin.id);
      const event = await row(
        'select created_by::text as v, status, photo_path from public.match_events where id = ' +
          L(w.eventId)
      );
      expect(event['v']).toBe(w.admin.id);
      expect(event['status']).toBe('open');
      expect(event['photo_path']).toBeNull(); // uploader was the erased owner: no-photo contract
      expect(await tablesMentioning(w.owner.id)).toEqual([]);
      expect(
        await scalar(
          'select count(*)::int from public.community_members where valid_until is null and user_id = ' +
            L(w.owner.id)
        )
      ).toBe(0);
    });

    it('archives the community ownerless, retires future activity and keeps results without a successor', async () => {
      const w = await ownershipWorld('archive');
      await eraseAccount(w.owner.id);

      const community = await row(
        'select archived_at, created_by::text as owner from public.communities where id = ' +
          L(w.communityId)
      );
      expect(community['archived_at']).not.toBeNull();
      expect(community['owner']).not.toBe(w.owner.id);
      expect(
        await scalar(
          'select count(*)::int from public.participant_identities where id = ' +
            L(String(community['owner'])) +
            " and state = 'withdrawn'"
        )
      ).toBe(1);
      const event = await row(
        'select status, cancel_reason from public.match_events where id = ' + L(w.eventId)
      );
      expect(event['status']).toBe('cancelled');
      expect(
        (await row('select status::text as s from public.leagues where id = ' + L(w.leagueId)))['s']
      ).toBe('closed');
      // The registration of the other player was retired with the event, not deleted.
      expect(
        await scalar(
          'select count(*)::int from public.match_event_registrations where match_event_id = ' +
            L(w.eventId) +
            ' and user_id = ' +
            L(w.admin.id)
        )
      ).toBe(1);
      // Tombstones and archived communities accept no new activity.
      await expect(
        fixtureSql(
          'insert into public.community_members(community_id, user_id, role, status, valid_from) values (' +
            L(w.communityId) +
            ', ' +
            L(w.member.id) +
            ", 'member', 'pending', now())"
        )
      ).rejects.toThrow(/COMMUNITY_ARCHIVED|duplicate key/);
      await expect(
        fixtureSql(
          'update public.communities set created_by = ' +
            L(String(community['owner'])) +
            ' where id = ' +
            L(w.communityId)
        )
      ).resolves.not.toThrow();
      await expect(
        fixtureSql(
          'insert into public.community_invitations(community_id, invitee_user_id, issued_by, token_hash, expires_at) values (' +
            L(w.communityId) +
            ', ' +
            L(w.member.id) +
            ', ' +
            L(String(community['owner'])) +
            ", repeat('a', 64), now() + interval '1 day')"
        )
      ).rejects.toThrow(/COMMUNITY_ARCHIVED|PARTICIPANT_WITHDRAWN/);
      expect(await tablesMentioning(w.owner.id)).toEqual([]);
    });

    it('blocks an invalid successor and a platform admin without changing anything', async () => {
      const w = await ownershipWorld('blocked');
      // A plain member is not an eligible successor.
      const plan = await erasurePlan(w.owner.id, { communities: { [w.communityId]: w.member.id } });
      expect(plan.blockers).toContain('successor_invalid');
      await expect(executeErasure(w.owner.id, approvedPlan(plan))).rejects.toThrow(
        /ACCOUNT_ERASURE_BLOCKED/
      );

      await fixtureSql(
        'insert into public.platform_admins(user_id, granted_by) values (' +
          L(w.member.id) +
          ', ' +
          L(w.admin.id) +
          ')'
      );
      const adminPlan = await erasurePlan(w.member.id);
      expect(adminPlan.blockers).toContain('platform_admin_grant');
      await expect(executeErasure(w.member.id, approvedPlan(adminPlan))).rejects.toThrow(
        /ACCOUNT_ERASURE_BLOCKED/
      );
      expect(
        await scalar(
          'select count(*)::int from public.participant_identities where id = ' +
            L(w.member.id) +
            " and state = 'live'"
        )
      ).toBe(1);
      expect(
        (await row('select archived_at from public.communities where id = ' + L(w.communityId)))[
          'archived_at'
        ]
      ).toBeNull();
      await fixtureSql('delete from public.platform_admins where user_id = ' + L(w.member.id));
    });

    it('keeps a provisional invitee claimable when its inviter departs (redacted provenance)', async () => {
      const w = await ownershipWorld('provisional');
      const provisional = await signUpFixtureActor(environment.env!, 'provisional-invitee');
      expect(
        await provisionProvisionalPlayer({
          userId: provisional.id,
          displayName: 'Invited Player',
          estimatedLevel: 4,
          invitedBy: w.admin.id,
          sourceEventId: w.eventId
        })
      ).toBe(true);
      await ensureProvisionalMembership({
        communityId: w.communityId,
        userId: provisional.id,
        addedBy: w.admin.id,
        sourceEventId: w.eventId
      });
      await eraseAccount(w.admin.id, { communities: {}, leagues: {}, matches: {} });

      const profile = await row(
        'select is_provisional, rating_input_source, estimated_level::float8 as level, invited_by::text as inviter from public.player_profiles where user_id = ' +
          L(provisional.id)
      );
      expect(profile['is_provisional']).toBe(true);
      expect(profile['rating_input_source']).toBe('creator_estimated');
      expect(profile['level']).toBe(4);
      expect(profile['inviter']).not.toBeNull();
      expect(profile['inviter']).not.toBe(w.admin.id);
      expect(profile['inviter']).not.toBe(provisional.id);
      expect(
        await scalar(
          'select count(*)::int from public.participant_identities where id = ' +
            L(String(profile['inviter'])) +
            " and state = 'withdrawn'"
        )
      ).toBe(1);
      const membership = await row(
        'select added_by::text as added_by, source_match_event_id::text as src from public.community_members where user_id = ' +
          L(provisional.id)
      );
      expect(membership['added_by']).toBe(profile['inviter']);
      expect(await tablesMentioning(w.admin.id)).toEqual([]);
    });

    it('creates no tombstone when there is no retained history', async () => {
      const lone = await signUpFixtureActor(environment.env!, 'lone', {
        displayName: 'Lone Player',
        level: 3
      });
      const withdrawnBefore = await countWithdrawn();
      const result = await eraseAccount(lone.id);
      expect(result['tombstone_created']).toBe(false);
      expect(await countWithdrawn()).toBe(withdrawnBefore);
      expect(
        await scalar(
          'select count(*)::int from public.participant_identities where id = ' + L(lone.id)
        )
      ).toBe(0);
      expect(
        await scalar(
          'select count(*)::int from public.player_profiles where user_id = ' + L(lone.id)
        )
      ).toBe(0);
      expect(await tablesMentioning(lone.id)).toEqual([]);
    });
  }
);
