import { describe, expect, it } from 'vitest';
import {
  confirmGroup,
  eraseAccount,
  erasurePlan,
  scalar,
  survivorSnapshot,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * Unit F finding: a community/league member with NO match registration used to abort with
 * RESIDUAL_REFERENCE because the derived statistics rebuild only covered communities reached through event
 * registrations. The rebuild scope is now every community the subject has membership, counters, facts or
 * league positions in.
 */
describe.skipIf(!environment.env)(
  'Account erasure of a member without registrations',
  { timeout: 600_000 },
  () => {
    it('erases cleanly, leaves no derived reference and keeps survivors consistent', async () => {
      const kit = await createRankedResultFixtures(environment.env!);
      const leagueId = await kit.league();
      const eventId = await kit.event(leagueId);
      await confirmGroup(kit, eventId, 1);
      await confirmGroup(kit, eventId, 2);

      // A community member who joined and never played: membership, profile and rating only.
      const subject = await kit.member();
      await fixtureSql(
        'insert into public.player_profiles(user_id, display_name, preferred_side) values (' +
          L(subject.id) +
          ", 'Never Played', 'EITHER');" +
          'select public.initialize_global_player_rating_locked(' +
          L(subject.id) +
          ", 3.0, 'onboarding');" +
          'select public.rebuild_statistics(' +
          L(kit.communityId) +
          ');'
      );
      expect(
        Number(
          await scalar(
            'select count(*)::int from public.match_event_registrations where user_id = ' +
              L(subject.id)
          )
        )
      ).toBe(0);
      const derived = (await tablesMentioning(subject.id)).filter((table) =>
        table.startsWith('statistics_')
      );
      expect(derived.length).toBeGreaterThan(0);

      const survivors = kit.players.map((player) => player.id);
      const before = await survivorSnapshot(survivors, kit.communityId, [eventId]);
      const standings = async () =>
        sqlRows(
          'select player_id::text, league_id::text from public.statistics_league_positions where community_id = ' +
            L(kit.communityId) +
            ' order by 1, 2'
        );
      const positionsBefore = (await standings()).filter((row) => row['player_id'] !== subject.id);

      // The dry run reports the new scope and equals the executed plan (drift contract intact).
      const plan = await erasurePlan(subject.id);
      expect(plan.blockers).toEqual([]);
      expect(asRecord(plan.impact['ownership'])['rebuild_communities']).toBe(1);
      expect(Number(plan.impact['derived_rebuild'])).toBeGreaterThan(0);

      const result = await eraseAccount(subject.id);
      expect(result['tombstone_created']).toBe(true);
      expect(await tablesMentioning(subject.id)).toEqual([]);
      expect(await survivorSnapshot(survivors, kit.communityId, [eventId])).toEqual(before);
      expect(await standings()).toEqual(positionsBefore);
      expect(
        await scalar(
          'select count(*)::int from public.participant_identities where id = ' + L(subject.id)
        )
      ).toBe(0);
    });
  }
);
