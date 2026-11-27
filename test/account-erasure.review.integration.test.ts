import { describe, expect, it } from 'vitest';
import { eraseAccount, erasurePlan, scalar } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql } from './helpers/match-registration-sql';
import { insertLeague } from './helpers/league-fixtures';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

async function world(label: string) {
  const env = environment.env!;
  const owner = await signUpFixtureActor(env, label + '-owner', {
    displayName: ('Owner ' + label).slice(0, 40),
    level: 4
  });
  const communityId = crypto.randomUUID();
  await insertFixtureCommunity({ id: communityId, visibility: 'public', adminId: owner.id });
  const eventId = crypto.randomUUID();
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  const leagueId = await insertLeague({
    communityId,
    ownerId: owner.id,
    status: 'upcoming',
    startAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 9 * 86_400_000).toISOString()
  });
  return { owner, communityId, eventId, leagueId };
}

/** Review F11: retirement only touches communities archived BY this erasure. */
describe.skipIf(!environment.env)('Erasure retirement scope', { timeout: 300_000 }, () => {
  it('leaves an unrelated, already archived community untouched and retires the newly archived one once', async () => {
    const before = await world('f11-old');
    await fixtureSql(
      "update public.communities set archived_at = now() - interval '2 days' where id = " +
        L(before.communityId)
    );
    const target = await world('f11-new');

    const plan = await erasurePlan(target.owner.id);
    const ownership = asRecord(plan.impact['ownership']);
    expect(ownership['retired_leagues']).toBe(1);
    expect(ownership['retired_events']).toBe(1);

    await eraseAccount(target.owner.id);
    // Newly archived by this erasure: its activity is retired exactly once.
    expect(
      await scalar('select status from public.match_events where id = ' + L(target.eventId))
    ).toBe('cancelled');
    expect(
      await scalar('select status::text from public.leagues where id = ' + L(target.leagueId))
    ).toBe('closed');
    expect(
      await scalar(
        "select count(*)::int from public.match_event_audit_log where action = 'cancel' and match_event_id = " +
          L(target.eventId)
      )
    ).toBe(1);
    // Archived before, owned by someone else: untouched.
    expect(
      await scalar('select status from public.match_events where id = ' + L(before.eventId))
    ).toBe('open');
    expect(
      await scalar('select status::text from public.leagues where id = ' + L(before.leagueId))
    ).toBe('upcoming');
    expect(
      await scalar(
        "select count(*)::int from public.match_event_audit_log where action = 'cancel' and match_event_id = " +
          L(before.eventId)
      )
    ).toBe(0);
  });
});
