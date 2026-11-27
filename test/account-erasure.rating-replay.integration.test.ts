import { beforeAll, describe, expect, it } from 'vitest';
import { confirmGroup, eraseAccount, scalar } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * An erased player keeps its rating history under a withdrawn identity that has no profile and no live rating row.
 * Every later projection REPLAY (out-of-order result, amendment, repair, activation) rebuilds the whole stream from
 * the ledger, so it must accept those identities instead of failing 'Incomplete player state' for everybody.
 */
describe.skipIf(!environment.env)(
  'Rating replay after an account erasure',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      const eventId = await kit.event(await kit.league());
      await confirmGroup(kit, eventId, 1);
      await confirmGroup(kit, eventId, 2);
    });

    it('replays the whole ledger, withdrawn identity included, in a transaction that rolls back', async () => {
      const subject = kit.players[3]!.id;
      expect(
        Number(
          await scalar(
            'select count(*)::int from public.player_rating_events where user_id = ' + L(subject)
          )
        )
      ).toBeGreaterThan(0);
      await eraseAccount(subject);
      // The tombstone owns events and an initialization but has no rating state row.
      expect(
        Number(
          await scalar(
            "select count(*)::int from public.player_rating_events e join public.participant_identities i on i.id = e.user_id where i.state = 'withdrawn'"
          )
        )
      ).toBeGreaterThan(0);
      expect(
        Number(
          await scalar(
            "select count(*)::int from public.global_player_ratings r join public.participant_identities i on i.id = r.user_id where i.state = 'withdrawn'"
          )
        )
      ).toBe(0);
      await expect(
        fixtureSql(
          'do $probe$ declare v_revision bigint; v_replay record; begin ' +
            'select c.committed_revision + 1 into v_revision from public.player_rating_projection_control c where c.singleton; ' +
            'select * into v_replay from public.rating_projection_replay(v_revision); ' +
            "raise exception 'PROBE:groups=%', v_replay.o_groups; end $probe$;"
        )
      ).rejects.toThrow(/PROBE:groups=[1-9]/);
    });
  }
);
