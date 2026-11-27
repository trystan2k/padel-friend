import { afterAll, describe, expect, it } from 'vitest';
import {
  discardSnapshot,
  restoreSnapshotWithGate,
  takeSnapshot,
  type Snapshot
} from '../scripts/release-backup-restore.mjs';
import { createDocker, dropDatabase } from '../scripts/release-rehearsal-lib.mjs';
import { scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  setQuiescence,
  sweep,
  uploadObject,
  verifyCase
} from './helpers/privacy-request-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * Review F8: synthetic restore rehearsal with erasure. A pre-erasure snapshot of the TEST stack is taken, the
 * real erasure path runs, and the snapshot is restored into an isolated scratch database. The erased subject
 * exists again ONLY in the restored copy (why post-restore reconciliation is mandatory), and the restored
 * environment starts with the privacy executor and intake off behind a restore gate that cannot be lifted
 * before the real erasure was replayed on the restored subject (zero residue proven) and an evidence reference
 * was recorded. No identity ledger: the gate row keeps the evidence reference only.
 */
describe.skipIf(!environment.env)(
  'Restore rehearsal with account erasure',
  { timeout: 600_000 },
  () => {
    const docker = createDocker();
    const base = 'restore_rehearsal_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    let snapshot: Snapshot | undefined;
    afterAll(() => {
      dropDatabase(docker, base);
      if (snapshot) discardSnapshot(docker, snapshot);
    });

    it('restores an erased account only into the scratch copy and keeps the restored environment gated', async () => {
      await setQuiescence(0);
      const kit = await createRankedResultFixtures(environment.env!);
      const subject = kit.players[3]!;
      // Synthetic pre-erasure state: the subject's avatar reference points at a fake file.
      const avatarKey = subject.id + '/' + crypto.randomUUID() + '.png';
      await uploadObject('player-avatars', avatarKey, 'image/png');
      await fixtureSql(
        'update public.player_profiles set avatar_url = ' +
          L(avatarKey) +
          ' where user_id = ' +
          L(subject.id)
      );
      const email = String(
        await scalar('select email from auth.users where id = ' + L(subject.id))
      );

      snapshot = takeSnapshot(docker);

      // The real erasure path, after the snapshot.
      const request = await subject.client.rpc('request_account_deletion', {
        p_command_id: crypto.randomUUID()
      });
      expect(request.error).toBeNull();
      const reference = String(
        Object.fromEntries(Object.entries(Object(request.data)))['reference']
      );
      await verifyCase(reference, email);
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(await tablesMentioning(subject.id)).toEqual([]);
      expect(await scalar('select count(*)::int from auth.users where id = ' + L(subject.id))).toBe(
        0
      );

      const restored = restoreSnapshotWithGate(docker, snapshot, { base });
      expect(restored.gate).toEqual({ pending: true, intakeOff: true, executorOff: true });
      const query = (statement: string) => docker.sql(restored.destination, statement);
      const count = (table: string, column: string) =>
        Number(
          query('select count(*) from ' + table + ' where ' + column + ' = ' + L(subject.id) + ';')
        );

      // Snapshot semantics: the erased subject is back in the scratch copy (never in the live stack).
      expect(count('public.player_profiles', 'user_id')).toBe(1);
      expect(count('public.participant_identities', 'id')).toBe(1);
      expect(count('auth.users', 'id')).toBe(1);
      expect(
        query(
          'select avatar_url from public.player_profiles where user_id = ' + L(subject.id) + ';'
        )
      ).toBe(avatarKey);
      expect(
        Number(
          query(
            'select count(*) from privacy_internal.privacy_cases where reference = ' +
              L(reference) +
              ';'
          )
        )
      ).toBe(0);

      // The gate is fail-closed: switches stay off, cannot be turned on, and nothing can be claimed.
      expect(
        query(
          "select string_agg(key || '=' || value, ',' order by key) from privacy_internal.privacy_settings;"
        )
      ).toBe(
        'executor_enabled=false,freeze_quiescence_seconds=0,intake_enabled=false,privacy_quiescence_max_attempts=12'
      );
      expect(query('select status from privacy_internal.restore_gate;')).toBe('pending');
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('RESTORE_GATE_PENDING');
      expect(query("select public.privacy_op_set_switch('intake_enabled', true)::text;")).toContain(
        'RESTORE_GATE_PENDING'
      );
      expect(query("select coalesce(public.privacy_proc_claim(120, 'local')::text, 'none');")).toBe(
        'none'
      );
      expect(query("select to_regclass('cron.job') is null;")).toBe('t');

      // NEGATIVE: the gate cannot be cleared by assertion alone, however good the evidence text looks.
      const evidence = 'post-snapshot erasures reconciled: ticket 123';
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('RECONCILIATION_REQUIRED');
      expect(query('select status from privacy_internal.restore_gate;')).toBe('pending');

      // NEGATIVE: residue the erasure cannot remove (an unclassified copy of the subject id) fails closed and
      // leaves the restored subject untouched (the whole reconcile rolls back).
      query('create table public.zz_restore_residue(note text);');
      query('insert into public.zz_restore_residue values (' + L('copy of ' + subject.id) + ');');
      const refused = query(
        'select public.privacy_op_restore_reconcile(' + L(subject.id) + ')::text;'
      );
      expect(refused).toContain('RESTORE_RECONCILE_RESIDUE');
      expect(refused).toContain('public.zz_restore_residue');
      expect(count('public.player_profiles', 'user_id')).toBe(1);
      expect(query('select status from privacy_internal.restore_gate;')).toBe('pending');
      query('drop table public.zz_restore_residue;');

      // The real reconciliation: the erasure replays on the restored subject and proves zero residue.
      expect(
        query('select public.privacy_op_restore_reconcile(' + L(subject.id) + ')::text;')
      ).toContain('"reconciled"');
      expect(count('public.player_profiles', 'user_id')).toBe(0);
      expect(count('public.participant_identities', 'id')).toBe(0);
      expect(count('auth.users', 'id')).toBe(0);
      expect(
        query(
          'select count(*) from public.player_profiles where avatar_url = ' + L(avatarKey) + ';'
        )
      ).toBe('0');
      expect(
        query(
          'select pg_catalog.cardinality(privacy_internal.subject_residue(' + L(subject.id) + '));'
        )
      ).toBe('0');
      expect(query('select status from privacy_internal.restore_gate;')).toBe('reconciled');

      // Closing needs the evidence reference, which is persisted (the restored subject id is not kept).
      expect(query("select public.privacy_op_restore_gate('clear', '   ')::text;")).toContain(
        'RECONCILIATION_EVIDENCE_REQUIRED'
      );
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('"closed"');
      expect(
        query(
          "select status || '|' || evidence_ref || '|' || (reconciled_at is not null) || '|' || (reconciled_subject is null) from privacy_internal.restore_gate;"
        )
      ).toBe('closed|' + evidence + '|true|true');
      // A closed gate has nothing left to reconcile, and the switches stay off until turned on explicitly.
      expect(
        query('select public.privacy_op_restore_reconcile(' + L(subject.id) + ')::text;')
      ).toContain('RESTORE_GATE_NOT_OPEN');
      expect(
        query("select value from privacy_internal.privacy_settings where key = 'executor_enabled';")
      ).toBe('false');
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('"ok"');

      // The live stack never regained the account.
      expect(
        await scalar(
          'select count(*)::int from public.player_profiles where user_id = ' + L(subject.id)
        )
      ).toBe(0);
    });
  }
);
