import { afterAll, describe, expect, it } from 'vitest';
import { deriveExpectedSubjects, reconcileRestoredSubject } from '../scripts/privacy-operator.mjs';
import type { OperatorClient } from '../scripts/privacy-operator.mjs';
import {
  applyRestoreGate,
  discardSnapshot,
  markRestoreTarget,
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
 * Restore rehearsal with account erasure (F8, F17, F21, F22, F27-F30). Three subjects are erased by the real path
 * after a snapshot; the snapshot is restored into an isolated scratch database that the restore flow flags
 * (app.restore_target). The restored gate proves its expected set by count parity with the source tombstones, each
 * subject is reconciled through the two-phase Storage proof and the database replay, and the gate closes only with
 * complete coverage, parity again and a persisted evidence reference.
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

    it('proves isolation, count parity, the storage proof and exact coverage before the restored gate can close', async () => {
      await setQuiescence(0);
      const kit = await createRankedResultFixtures(environment.env!);
      await kit.event();
      const [subjectA, subjectB, keeper, subjectC] = [
        kit.players[3]!,
        kit.players[4]!,
        kit.players[5]!,
        kit.players[6]!
      ];
      const [idA, idB, idC] = [subjectA.id, subjectB.id, subjectC.id];
      const emailOf = async (id: string) =>
        String(await scalar('select email from auth.users where id = ' + L(id)));

      // Pre-snapshot state: A's avatar pointer references a fake object, and an ORPHAN object (no pointer) sits under
      // the same prefix. Both are real bytes in the TEST bucket, uploaded through the Storage API.
      const avatarPath = idA + '/' + crypto.randomUUID() + '.png';
      const orphanPath = idA + '/orphan-' + crypto.randomUUID() + '.png';
      await uploadObject('player-avatars', avatarPath, 'image/png');
      await uploadObject('player-avatars', orphanPath, 'image/png');
      await fixtureSql(
        'update public.player_profiles set avatar_url = ' +
          L(avatarPath) +
          ' where user_id = ' +
          L(idA)
      );
      // A subject-owned ATTACHMENT pointer (uploader segment = A) that is still non-null in the snapshot.
      const venue = crypto.randomUUID();
      const photoPath =
        kit.communityId + '/' + venue + '/' + idA + '/p-' + crypto.randomUUID() + '.webp';
      await uploadObject('community-venue-photos', photoPath, 'image/webp');
      await fixtureSql(
        'insert into public.community_venues(id, community_id, name, created_by, photo_path) values (' +
          [L(venue), L(kit.communityId), L('Rehearsal Venue'), L(idA), L(photoPath)].join(', ') +
          ')'
      );
      const emails = { a: await emailOf(idA), b: await emailOf(idB), c: await emailOf(idC) };

      snapshot = takeSnapshot(docker);
      const takenAt = snapshot.takenAt;
      // The parity authority: identity-free erasure events recorded after the snapshot.
      const erasuresNow = async () =>
        Number(
          await scalar(
            'select count(*)::int from privacy_internal.erasure_events where erased_at > ' +
              L(takenAt)
          )
        );
      const erase = async (subject: typeof subjectA, email: string) => {
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
      };

      // The real erasure path for A and B (one at a time: the second plan sees the first erasure).
      await erase(subjectA, emails.a);
      await erase(subjectB, emails.b);
      expect(await tablesMentioning(idA)).toEqual([]);
      expect(await objectExists('player-avatars', avatarPath)).toBe(false);
      // A real storage restore brings the pre-snapshot bytes back; simulate it before reconciling.
      await uploadObject('player-avatars', avatarPath, 'image/png');
      await uploadObject('player-avatars', orphanPath, 'image/png');
      expect(await objectExists('community-venue-photos', photoPath)).toBe(false);
      await uploadObject('community-venue-photos', photoPath, 'image/webp');
      expect(await erasuresNow()).toBe(2);

      // F28: the live database never carries the isolation flag and refuses every restore RPC.
      expect(
        await scalar("select coalesce(current_setting('app.restore_target', true), 'unset')")
      ).not.toBe('on');
      const liveBegin = await trustedClient().rpc('privacy_op_restore_gate', {
        p_action: 'begin',
        p_snapshot_at: takenAt,
        p_expected_subjects: [idA, idB],
        p_restore_project_ref: 'live',
        p_tombstone_count: 2
      });
      expect(liveBegin.data).toEqual({ status: 'rejected', code: 'RESTORE_NOT_ISOLATED' });
      expect(await scalar('select status from privacy_internal.restore_gate')).toBe('closed');
      // A caller SETting the session parameter does not make a database isolated (no marker row), and clear checks too.
      for (const call of [
        "public.privacy_op_restore_gate('begin', null, now(), array[]::uuid[], 'x', 0)",
        "public.privacy_op_restore_gate('clear', 'evidence', null, null, null, 0)",
        'public.privacy_op_restore_reconcile(' + L(keeper.id) + ", 'x')"
      ])
        await expect(
          fixtureSql(
            "do $p$ begin perform set_config('app.restore_target', 'on', true); raise exception 'PROBE:%', " +
              call +
              '::text; end $p$;'
          )
        ).rejects.toThrow(/PROBE:.*RESTORE_NOT_ISOLATED/);
      // And no client role (service_role included) can write the marker.
      await expect(
        fixtureSql(
          'set local role service_role; insert into privacy_internal.restore_isolation_marker(database_name) values (current_database())'
        )
      ).rejects.toThrow(/permission denied/);
      expect(
        await scalar('select count(*)::int from privacy_internal.restore_isolation_marker')
      ).toBe(0);
      expect(
        (
          await trustedClient().rpc('privacy_op_restore_reconcile', {
            p_subject: keeper.id,
            p_project_ref: 'live'
          })
        ).data
      ).toEqual({ status: 'rejected', code: 'RESTORE_NOT_ISOLATED' });

      const liveIds = (
        await sqlRows(
          "select id::text as id from public.participant_identities where state = 'live'"
        )
      ).map((row) => String(row['id']));
      const derive = (destination: string) =>
        deriveExpectedSubjects({
          restored: docker
            .sql(
              destination,
              "select id from public.participant_identities where state = 'live' order by id;"
            )
            .split('\n')
            .filter(Boolean),
          live: liveIds
        });

      // F29: the derived set (2) must equal the source tombstones: a source reporting another number is refused.
      const refusedRestore = restoreSnapshotWithGate(docker, snapshot, {
        base,
        expectedSubjects: derive,
        tombstoneCount: 1
      });
      expect(refusedRestore.gate.pending).toBe(false);
      const query = (statement: string) => docker.sql(refusedRestore.destination, statement);
      const destination = refusedRestore.destination;
      expect(query("select current_setting('app.restore_target', true);")).toBe('on');
      expect(query('select status from privacy_internal.restore_gate;')).toBe('closed');
      // Fail closed even though the begin was refused: the restored switches are off.
      expect(
        query(
          "select count(*) from privacy_internal.privacy_settings where key like '%_enabled' and value = 'true';"
        )
      ).toBe('0');
      expect(
        applyRestoreGate(docker, destination, {
          snapshotAt: takenAt,
          expectedSubjects: derive(destination),
          tombstoneCount: 2
        })
      ).toEqual({ pending: true, intakeOff: true, executorOff: true });

      const count = (table: string, column: string, id: string) =>
        Number(query('select count(*) from ' + table + ' where ' + column + ' = ' + L(id) + ';'));
      const gate = () =>
        query(
          "select status || '|' || cardinality(expected_subjects) || '|' || cardinality(reconciled_subjects) from privacy_internal.restore_gate;"
        );
      const literal = (value: unknown): string =>
        value === null || value === undefined
          ? 'null'
          : typeof value === 'boolean' || typeof value === 'number'
            ? String(value)
            : Array.isArray(value)
              ? 'array[' + value.map(literal).join(',') + ']::text[]'
              : L(typeof value === 'string' ? value : JSON.stringify(value));
      const rpc = (name: string, args: Record<string, unknown>) =>
        JSON.parse(
          query(
            'select public.' +
              name +
              '(' +
              Object.entries(args)
                .map(([key, value]) => key + ' => ' + literal(value))
                .join(', ') +
              ')::text;'
          )
        );
      const scratch: OperatorClient = {
        rpc: (name, args) => {
          try {
            return Promise.resolve({ data: rpc(name, args), error: null });
          } catch (error) {
            return Promise.resolve({ data: null, error });
          }
        },
        storage: trustedClient().storage
      };
      const reconcile = async (subject: string, ref = destination) =>
        Object.fromEntries(
          Object.entries(Object(await reconcileRestoredSubject(scratch, subject, ref)))
        );

      expect(gate()).toBe('pending|2|0');
      for (const id of [idA, idB, idC])
        expect(count('public.player_profiles', 'user_id', id)).toBe(1);
      expect(
        query('select avatar_url from public.player_profiles where user_id = ' + L(idA) + ';')
      ).toBe(avatarPath);
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('RESTORE_GATE_PENDING');
      expect(query("select coalesce(public.privacy_proc_claim(120, 'local')::text, 'none');")).toBe(
        'none'
      );

      // F28: without the database flag every restore RPC refuses; the restore flow sets it.
      docker.exec(
        ['psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
        {
          input: 'alter database "' + destination + '" reset app.restore_target;'
        }
      );
      expect(
        query(
          "select current_setting('app.restore_target', true) is null or current_setting('app.restore_target', true) = '';"
        )
      ).toBe('t');
      for (const statement of [
        "select public.privacy_op_restore_gate('begin', null, now(), array[]::uuid[], 'x', 0)::text;",
        'select public.privacy_op_restore_storage_set(' +
          L(idA) +
          ", '" +
          destination +
          "')::text;",
        'select public.privacy_op_restore_storage_confirm(' +
          L(idA) +
          ", '" +
          destination +
          "', array[]::text[], array[]::text[])::text;",
        'select public.privacy_op_restore_reconcile(' + L(idA) + ", '" + destination + "')::text;"
      ])
        expect(query(statement)).toContain('RESTORE_NOT_ISOLATED');
      expect(gate()).toBe('pending|2|0');
      markRestoreTarget(docker, destination);
      // The marker is the authority: with the setting on but the marker gone, everything is refused again.
      const asAdmin = (statement: string) =>
        docker.exec(
          ['psql', '-U', 'supabase_admin', '-d', destination, '-v', 'ON_ERROR_STOP=1', '-q'],
          { input: statement }
        );
      asAdmin('delete from privacy_internal.restore_isolation_marker;');
      expect(query("select current_setting('app.restore_target', true);")).toBe('on');
      expect(
        query("select public.privacy_op_restore_gate('clear', 'x', null, null, null, 0)::text;")
      ).toContain('RESTORE_NOT_ISOLATED');
      expect(
        query(
          'select public.privacy_op_restore_reconcile(' + L(idA) + ", '" + destination + "')::text;"
        )
      ).toContain('RESTORE_NOT_ISOLATED');
      // A marker naming another database (a dump restored under a new name) is not accepted either.
      asAdmin(
        "insert into privacy_internal.restore_isolation_marker(database_name) values ('some_other_db');"
      );
      expect(
        query(
          'select public.privacy_op_restore_reconcile(' + L(idA) + ", '" + destination + "')::text;"
        )
      ).toContain('RESTORE_NOT_ISOLATED');
      markRestoreTarget(docker, destination);
      expect(gate()).toBe('pending|2|0');

      // F21/F22: outside the expected set, wrong project, no trace: refused, nothing changes.
      const random = crypto.randomUUID();
      expect(await reconcile(random)).toMatchObject({ code: 'RESTORE_SUBJECT_NOT_EXPECTED' });
      expect(await reconcile(keeper.id)).toMatchObject({ code: 'RESTORE_SUBJECT_NOT_EXPECTED' });
      expect(count('public.player_profiles', 'user_id', keeper.id)).toBe(1);
      expect(await reconcile(idA, 'local')).toMatchObject({ code: 'RESTORE_PROJECT_MISMATCH' });
      query(
        'update privacy_internal.restore_gate set expected_subjects = expected_subjects || ' +
          L(random) +
          '::uuid;'
      );
      expect(await reconcile(random)).toMatchObject({ code: 'RESTORE_SUBJECT_NOT_FOUND' });
      // A member that can never be traced keeps the gate pending: closing is impossible (fail closed).
      expect(gate()).toBe('pending|3|0');
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', 'ticket 1', null, null, null, 2)::text;"
        )
      ).toContain('RECONCILIATION_REQUIRED');
      query(
        'update privacy_internal.restore_gate set expected_subjects = array_remove(expected_subjects, ' +
          L(random) +
          '::uuid);'
      );
      expect(gate()).toBe('pending|2|0');
      expect(query("select public.privacy_op_restore_gate('clear', 'ticket 1')::text;")).toContain(
        'RECONCILIATION_REQUIRED'
      );

      // F30: the plan covers the pointer AND the orphan found only through the prefix listing.
      const avatar = 'player-avatars/' + avatarPath;
      const orphan = 'player-avatars/' + orphanPath;
      const planned = rpc('privacy_op_restore_storage_set', {
        p_subject: idA,
        p_project_ref: destination,
        p_prefix_paths: [orphan]
      });
      // ...and the attachment pointer that is still non-null in the restored copy.
      const photo = 'community-venue-photos/' + photoPath;
      expect([...planned.plan].sort((a, b) => a.localeCompare(b))).toEqual(
        [avatar, orphan, photo].sort((a, b) => a.localeCompare(b))
      );
      expect(
        rpc('privacy_op_restore_storage_set', {
          p_subject: idA,
          p_project_ref: destination,
          p_prefix_paths: ['player-avatars/' + idB + '/x.png']
        })
      ).toMatchObject({ code: 'STORAGE_PATH_REJECTED' });
      // The DB phase refuses before the proof exists (no caller boolean any more).
      expect(
        rpc('privacy_op_restore_reconcile', { p_subject: idA, p_project_ref: destination })
      ).toMatchObject({
        code: 'RESTORE_STORAGE_PHASE_REQUIRED'
      });
      // A subset of the plan, or a lie about what is left, is refused.
      expect(
        rpc('privacy_op_restore_storage_confirm', {
          p_subject: idA,
          p_project_ref: destination,
          p_deleted_paths: [avatar],
          p_relisted_paths: []
        })
      ).toMatchObject({ code: 'STORAGE_INCOMPLETE' });
      const bucket = trustedClient().storage.from('player-avatars');
      expect((await bucket.remove([avatarPath, orphanPath])).error).toBeNull();
      expect(
        (await trustedClient().storage.from('community-venue-photos').remove([photoPath])).error
      ).toBeNull();
      expect(await objectExists('player-avatars', avatarPath)).toBe(false);
      expect(await objectExists('player-avatars', orphanPath)).toBe(false);
      expect(await objectExists('community-venue-photos', photoPath)).toBe(false);
      expect(
        rpc('privacy_op_restore_storage_confirm', {
          p_subject: idA,
          p_project_ref: destination,
          p_deleted_paths: [avatar, orphan, photo],
          p_relisted_paths: [orphan]
        })
      ).toMatchObject({ code: 'STORAGE_LIE' });
      expect(
        rpc('privacy_op_restore_storage_confirm', {
          p_subject: idA,
          p_project_ref: destination,
          p_deleted_paths: [avatar, orphan, photo],
          p_relisted_paths: []
        })
      ).toMatchObject({ status: 'ok', storage_verified: true });

      // Residue the erasure cannot remove (an unclassified copy of B's id) fails closed and rolls B back untouched.
      query('create table public.zz_restore_residue(note text);');
      query('insert into public.zz_restore_residue values (' + L('copy of ' + idB) + ');');
      expect(await reconcile(idB)).toMatchObject({
        status: 'rejected',
        code: 'RESTORE_RECONCILE_RESIDUE',
        detail: 'public.zz_restore_residue'
      });
      expect(count('public.player_profiles', 'user_id', idB)).toBe(1);
      query('drop table public.zz_restore_residue;');

      // A: database replay after its proven storage phase.
      expect(
        rpc('privacy_op_restore_reconcile', { p_subject: idA, p_project_ref: destination })
      ).toMatchObject({
        status: 'ok',
        restore_gate: 'pending'
      });
      expect(count('public.player_profiles', 'user_id', idA)).toBe(0);
      expect(count('auth.users', 'id', idA)).toBe(0);
      expect(gate()).toBe('pending|2|1');
      // B through the operator driver (listing, plan, deletion, re-list, confirmation, replay).
      expect(await reconcile(idB)).toMatchObject({ status: 'ok', restore_gate: 'reconciled' });
      expect(gate()).toBe('reconciled|2|2');

      // F29: an erasure made after the set was derived (C) shows at clear as extra parity: refused, then re-derived.
      await erase(subjectC, emails.c);
      expect(await erasuresNow()).toBe(3);
      const evidence = 'post-snapshot erasures reconciled: ticket 123';
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', " +
            L(evidence) +
            ', null, null, null, 3)::text;'
        )
      ).toContain('COUNT_MISMATCH');
      expect(gate()).toBe('reconciled|2|2');
      // Re-begin with the same snapshot EXTENDS the gate: C joins, A and B stay reconciled.
      const liveNow = (
        await sqlRows(
          "select id::text as id from public.participant_identities where state = 'live'"
        )
      ).map((row) => String(row['id']));
      expect(
        applyRestoreGate(docker, destination, {
          snapshotAt: takenAt,
          expectedSubjects: deriveExpectedSubjects({
            restored: query(
              "select id from public.participant_identities where state = 'live' order by id;"
            )
              .split('\n')
              .filter(Boolean),
            live: liveNow
          }),
          tombstoneCount: 3
        })
      ).toEqual({ pending: true, intakeOff: true, executorOff: true });
      expect(gate()).toBe('pending|3|2');
      expect(await reconcile(idC)).toMatchObject({ status: 'ok', restore_gate: 'reconciled' });
      expect(gate()).toBe('reconciled|3|3');
      // F29: coverage is re-derived at clear, not trusted from a flag or a status alone.
      query('update privacy_internal.restore_gate set coverage_complete = false;');
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', 'ticket 1', null, null, null, 3)::text;"
        )
      ).toContain('COVERAGE_INCOMPLETE');
      query(
        'update privacy_internal.restore_gate set coverage_complete = true, expected_subjects = expected_subjects || ' +
          L(random) +
          '::uuid;'
      );
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', 'ticket 1', null, null, null, 3)::text;"
        )
      ).toContain('COVERAGE_INCOMPLETE');
      query(
        'update privacy_internal.restore_gate set expected_subjects = array_remove(expected_subjects, ' +
          L(random) +
          '::uuid);'
      );
      expect(query('select coverage_complete from privacy_internal.restore_gate;')).toBe('t');

      // Close: parity holds, the evidence is persisted, the subject ids are not.
      expect(
        query("select public.privacy_op_restore_gate('clear', '   ', null, null, null, 3)::text;")
      ).toContain('RECONCILIATION_EVIDENCE_REQUIRED');
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', " +
            L(evidence) +
            ', null, null, null, 3)::text;'
        )
      ).toContain('"closed"');
      expect(
        query(
          "select status || '|' || evidence_ref || '|' || cardinality(expected_subjects) || '|' || cardinality(reconciled_subjects) || '|' || restore_project_ref || '|' || tombstone_count from privacy_internal.restore_gate;"
        )
      ).toBe('closed|' + evidence + '|0|0|' + destination + '|3');
      expect(await reconcile(idA)).toMatchObject({ code: 'RESTORE_GATE_NOT_PENDING' });
      expect(
        query("select public.privacy_op_set_switch('executor_enabled', true)::text;")
      ).toContain('"ok"');

      // F29: a verified-empty set needs zero parity: a source that still sees a tombstone cannot be declared empty.
      const later = new Date().toISOString();
      expect(
        query(
          "select public.privacy_op_restore_gate('begin', null, " +
            L(later) +
            ", array[]::uuid[], '" +
            destination +
            "', 1)::text;"
        )
      ).toContain('COUNT_MISMATCH');
      expect(
        applyRestoreGate(docker, destination, {
          snapshotAt: later,
          expectedSubjects: [],
          tombstoneCount: 0
        })
      ).toEqual({ pending: true, intakeOff: true, executorOff: true });
      expect(gate()).toBe('reconciled|0|0');
      expect(
        query(
          "select public.privacy_op_restore_gate('clear', " +
            L(evidence) +
            ', null, null, null, 0)::text;'
        )
      ).toContain('"closed"');

      // The live stack never regained any account, and no object came back.
      for (const id of [idA, idB, idC])
        expect(
          await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(id))
        ).toBe(0);
      expect(await objectExists('player-avatars', avatarPath)).toBe(false);
    });
  }
);
