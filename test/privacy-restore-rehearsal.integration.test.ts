import { afterAll, describe, expect, it } from 'vitest';
import { deriveExpectedSubjects, reconcileRestoredSubject } from '../scripts/privacy-operator.mjs';
import type { OperatorClient } from '../scripts/privacy-operator.mjs';
import {
  applyRestoreGate,
  discardSnapshot,
  restoreSnapshotWithGate,
  takeSnapshot,
  type Snapshot
} from '../scripts/release-backup-restore.mjs';
import { createDocker, dropDatabase } from '../scripts/release-rehearsal-lib.mjs';
import { scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  objectExists,
  setQuiescence,
  sweep,
  uploadObject,
  verifyCase
} from './helpers/privacy-request-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures } from './helpers/ranked-result-fixtures';
import { trustedClient } from './helpers/trusted-client';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * Restore rehearsal with account erasure (F8, F17, F21, F22, F27). Two subjects are erased by the real path after a
 * snapshot; the snapshot is restored into an isolated scratch database. The restored environment starts gated:
 * the expected subjects (live in the copy, gone from the live project) must ALL be reconciled by the real erasure
 * replay plus the Storage API phase, in THIS database and project, before the gate closes with persisted evidence.
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

    it('reconciles every expected subject (database + object bytes) before the restored gate can close', async () => {
      await setQuiescence(0);
      const kit = await createRankedResultFixtures(environment.env!);
      const [subjectA, subjectB, keeper] = [kit.players[3]!, kit.players[4]!, kit.players[5]!];
      const idsA = subjectA.id;
      const idsB = subjectB.id;

      // Pre-snapshot state: A's avatar pointer references a fake object that exists as real bytes in the TEST bucket.
      const avatarKey = idsA + '/' + crypto.randomUUID() + '.png';
      await uploadObject('player-avatars', avatarKey, 'image/png');
      await fixtureSql(
        'update public.player_profiles set avatar_url = ' +
          L(avatarKey) +
          ' where user_id = ' +
          L(idsA)
      );
      const emailOf = async (id: string) =>
        String(await scalar('select email from auth.users where id = ' + L(id)));
      const emails = { a: await emailOf(idsA), b: await emailOf(idsB) };

      snapshot = takeSnapshot(docker);

      // The real erasure path for both subjects, after the snapshot.
      const references: string[] = [];
      for (const subject of [subjectA, subjectB]) {
        const request = await subject.client.rpc('request_account_deletion', {
          p_command_id: crypto.randomUUID()
        });
        expect(request.error).toBeNull();
        references.push(
          String(Object.fromEntries(Object.entries(Object(request.data)))['reference'])
        );
      }
      await verifyCase(references[0]!, emails.a);
      await verifyCase(references[1]!, emails.b);
      // One at a time: the second plan is computed after the first erasure changed shared projections.
      await armCase(references[0]!);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      await armCase(references[1]!);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      for (const reference of references)
        expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(await tablesMentioning(idsA)).toEqual([]);
      expect(await objectExists('player-avatars', avatarKey)).toBe(false);
      // A real storage restore brings the pre-snapshot bytes back; simulate it before reconciling.
      await uploadObject('player-avatars', avatarKey, 'image/png');
      expect(await objectExists('player-avatars', avatarKey)).toBe(true);

      // The expected set is derived: live in the restored copy, gone from the live project.
      const liveIds = (
        await sqlRows(
          "select id::text as id from public.participant_identities where state = 'live'"
        )
      ).map((row) => String(row['id']));
      const restored = restoreSnapshotWithGate(docker, snapshot, {
        base,
        expectedSubjects: (destination) =>
          deriveExpectedSubjects({
            restored: docker
              .sql(
                destination,
                "select id from public.participant_identities where state = 'live' order by id;"
              )
              .split('\n')
              .filter(Boolean),
            live: liveIds
          })
      });
      expect(restored.gate).toEqual({ pending: true, intakeOff: true, executorOff: true });
      const query = (statement: string) => docker.sql(restored.destination, statement);
      const count = (table: string, column: string, id: string) =>
        Number(query('select count(*) from ' + table + ' where ' + column + ' = ' + L(id) + ';'));
      const gate = () =>
        query(
          "select status || '|' || cardinality(expected_subjects) || '|' || cardinality(reconciled_subjects) from privacy_internal.restore_gate;"
        );
      const literal = (value: unknown) =>
        value === null || value === undefined
          ? 'null'
          : typeof value === 'boolean'
            ? String(value)
            : L(typeof value === 'string' ? value : JSON.stringify(value));
      // The operator driver against the scratch database (RPCs) and the environment's Storage (the TEST bucket).
      const scratch: OperatorClient = {
        rpc: (name, args) => {
          try {
            return Promise.resolve({
              data: JSON.parse(
                query(
                  'select public.' +
                    name +
                    '(' +
                    Object.entries(args)
                      .map(([key, value]) => key + ' => ' + literal(value))
                      .join(', ') +
                    ')::text;'
                )
              ),
              error: null
            });
          } catch (error) {
            return Promise.resolve({ data: null, error });
          }
        },
        storage: trustedClient().storage
      };
      const reconcile = async (subject: string, ref = restored.destination) =>
        Object.fromEntries(
          Object.entries(Object(await reconcileRestoredSubject(scratch, subject, ref)))
        );

      // Snapshot semantics: both erased subjects are back in the scratch copy only, with A's pointer intact.
      expect(
        query("select array_to_string(expected_subjects, ',') from privacy_internal.restore_gate;")
          .split(',')
          .sort()
      ).toEqual([idsA, idsB].sort());
      expect(gate()).toBe('pending|2|0');
      for (const id of [idsA, idsB]) {
        expect(count('public.player_profiles', 'user_id', id)).toBe(1);
        expect(count('auth.users', 'id', id)).toBe(1);
      }
      expect(
        query('select avatar_url from public.player_profiles where user_id = ' + L(idsA) + ';')
      ).toBe(avatarKey);
      expect(await scalar('select count(*)::int from auth.users where id = ' + L(idsA))).toBe(0);

      // The gate is fail-closed: switches stay off and nothing can be claimed.
      expect(
        query(
          "select string_agg(key || '=' || value, ',' order by key) from privacy_internal.privacy_settings;"
        )
      ).toBe(
        'executor_enabled=false,freeze_quiescence_seconds=0,intake_enabled=false,privacy_quiescence_max_attempts=12'
      );
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('RESTORE_GATE_PENDING');
      expect(query("select coalesce(public.privacy_proc_claim(120, 'local')::text, 'none');")).toBe(
        'none'
      );
      expect(query("select to_regclass('cron.job') is null;")).toBe('t');

      // F21: an empty expected set must be confirmed, and an unreconciled gate cannot be cleared.
      expect(
        query(
          "select public.privacy_op_restore_gate('begin', null, now(), array[]::uuid[], false, 'x')::text;"
        )
      ).toContain('EXPECTED_SUBJECTS_REQUIRED');
      expect(gate()).toBe('pending|2|0');
      const evidence = 'post-snapshot erasures reconciled: ticket 123';
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('RECONCILIATION_REQUIRED');

      // F21: a subject outside the expected set is refused (nothing changes), whether random or a live person.
      const random = crypto.randomUUID();
      expect(await reconcile(random)).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_SUBJECT_NOT_EXPECTED'
      });
      // F22: a live project subject present in the copy is refused even though the gate and refs match.
      expect(count('public.player_profiles', 'user_id', keeper.id)).toBe(1);
      expect(await reconcile(keeper.id)).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_SUBJECT_NOT_EXPECTED'
      });
      expect(count('public.player_profiles', 'user_id', keeper.id)).toBe(1);
      // F22: the project binding refuses another project (e.g. the live one) outright.
      expect(await reconcile(idsA, 'local')).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_PROJECT_MISMATCH'
      });
      expect(count('public.player_profiles', 'user_id', idsA)).toBe(1);
      expect(gate()).toBe('pending|2|0');

      // F21: an expected id with no trace in the copy (typo) is refused and changes nothing.
      applyRestoreGate(docker, restored.destination, {
        snapshotAt: snapshot.takenAt,
        expectedSubjects: [idsA, idsB, random]
      });
      expect(await reconcile(random)).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_SUBJECT_NOT_FOUND'
      });
      expect(gate()).toBe('pending|3|0');
      applyRestoreGate(docker, restored.destination, {
        snapshotAt: snapshot.takenAt,
        expectedSubjects: [idsA, idsB]
      });
      expect(gate()).toBe('pending|2|0');

      // Residue the erasure cannot remove (an unclassified copy of B's id) fails closed and rolls B back untouched.
      query('create table public.zz_restore_residue(note text);');
      query('insert into public.zz_restore_residue values (' + L('copy of ' + idsB) + ');');
      expect(await reconcile(idsB)).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_RECONCILE_RESIDUE',
        detail: 'public.zz_restore_residue'
      });
      expect(count('public.player_profiles', 'user_id', idsB)).toBe(1);
      query('drop table public.zz_restore_residue;');

      // F27: reconciling A removes the object BYTES through the Storage API, replays the erasure, proves zero residue.
      expect(await reconcile(idsA)).toMatchObject({ status: 'ok', restore_gate: 'pending' });
      expect(await objectExists('player-avatars', avatarKey)).toBe(false);
      expect(count('public.player_profiles', 'user_id', idsA)).toBe(0);
      expect(count('public.participant_identities', 'id', idsA)).toBe(0);
      expect(count('auth.users', 'id', idsA)).toBe(0);
      expect(query('select cardinality(privacy_internal.subject_residue(' + L(idsA) + '));')).toBe(
        '0'
      );
      // Publication isolation: with only 1 of 2 expected subjects reconciled the gate cannot close.
      expect(gate()).toBe('pending|2|1');
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('RECONCILIATION_REQUIRED');
      expect(query("select public.privacy_op_set_switch('intake_enabled', true)::text;")).toContain(
        'RESTORE_GATE_PENDING'
      );

      // Complete coverage: reconciled; clearing then needs the evidence, which is persisted.
      expect(await reconcile(idsB)).toMatchObject({ status: 'ok', restore_gate: 'reconciled' });
      expect(gate()).toBe('reconciled|2|2');
      expect(query("select public.privacy_op_restore_gate('clear', '   ')::text;")).toContain(
        'RECONCILIATION_EVIDENCE_REQUIRED'
      );
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('"closed"');
      expect(
        query(
          "select status || '|' || evidence_ref || '|' || cardinality(expected_subjects) || '|' || cardinality(reconciled_subjects) || '|' || restore_project_ref from privacy_internal.restore_gate;"
        )
      ).toBe('closed|' + evidence + '|0|0|' + restored.destination);
      expect(await reconcile(idsA)).toMatchObject({ code: 'RESTORE_GATE_NOT_PENDING' });
      expect(
        query("select value from privacy_internal.privacy_settings where key = 'executor_enabled';")
      ).toBe('false');
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('"ok"');

      // F21: a verified-empty expected set is reconciled at once (evidence is still due).
      expect(
        applyRestoreGate(docker, restored.destination, {
          snapshotAt: snapshot.takenAt,
          expectedSubjects: []
        })
      ).toEqual({ pending: true, intakeOff: true, executorOff: true });
      expect(gate()).toBe('reconciled|0|0');
      expect(
        query("select public.privacy_op_restore_gate('clear', " + L(evidence) + ')::text;')
      ).toContain('"closed"');

      // The live stack never regained either account.
      for (const id of [idsA, idsB])
        expect(
          await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(id))
        ).toBe(0);
      expect(
        await scalar(
          'select count(*)::int from public.player_profiles where user_id = ' + L(keeper.id)
        )
      ).toBe(1);
    });
  }
);
