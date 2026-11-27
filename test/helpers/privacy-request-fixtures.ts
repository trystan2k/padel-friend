import { runCommand, parseArgs } from '../../scripts/privacy-operator.mjs';
import {
  sweepPrivacyRequestsOnSchedule,
  type PrivacyProcessorHooks
} from '../../src/features/privacy-requests/privacy-processor.server';
import type { AdminClient } from '../../src/lib/supabase/admin.server';
import { scalar } from './account-erasure-fixtures';
import { asRecord, fixtureSql, sqlRows } from './match-registration-sql';
import { sqlText } from './provisional-player-fixtures';
import { trustedClient } from './trusted-client';

const L = sqlText;
const TARGET = { projectRef: 'local', environment: 'local' } as const;

/** Tests execute immediately: the production settle time between freeze and erasure is not part of them. */
export async function setQuiescence(seconds: number) {
  await fixtureSql(
    "update privacy_internal.privacy_settings set value = '" +
      String(seconds) +
      "' where key = 'freeze_quiescence_seconds'"
  );
}

/** Tunes the quiescence attempt cap (the production default is 12 five-second cycles). */
export async function setQuiescenceCap(attempts: number) {
  await fixtureSql(
    "update privacy_internal.privacy_settings set value = '" +
      String(attempts) +
      "' where key = 'privacy_quiescence_max_attempts'"
  );
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the untyped trusted client is the service-role admin client
export const admin = () => trustedClient() as unknown as AdminClient;

/** Runs a real operator command (the production script path) against the test stack. */
export async function operator(...argv: string[]) {
  return asRecord(await runCommand(trustedClient(), parseArgs(argv), TARGET));
}

export async function caseRow(reference: string) {
  const [row] = await sqlRows(
    'select id::text as id, state, resume_state, last_phase, blocker_code, next_action, subject_id::text as subject_id, ' +
      'armed_consumed_at, arm_expires_at, destructive_started_at, attempt_count, quiescence_attempts, next_attempt_at, outcome, purge_after, ' +
      'final_response_at, lease_token::text as lease_token, phase_manifest, armed_plan from privacy_internal.privacy_cases where reference = ' +
      L(reference)
  );
  return asRecord(row);
}

/** Makes the case claimable again, as if the worker holding its lease had died. */
export async function expireLease(reference: string) {
  await fixtureSql(
    "update privacy_internal.privacy_cases set lease_expires_at = now() - interval '1 second', next_attempt_at = null where reference = " +
      L(reference)
  );
}

export async function sweep(
  options: { client?: AdminClient; hooks?: PrivacyProcessorHooks; maxCases?: number } = {}
) {
  return sweepPrivacyRequestsOnSchedule({
    client: options.client ?? admin(),
    env: {},
    projectRef: 'local',
    hooks: {
      ...options.hooks,
      // The freeze transaction's own commit can still be visible as an "older open transaction" to the very next
      // call (the quiescence check would then wait one 5 s cycle): give the commit a moment, as production's
      // cron-driven calls always do.
      afterStep: async (step) => {
        if (step === 'freeze') await new Promise((resolve) => setTimeout(resolve, 150));
        await options.hooks?.afterStep?.(step);
      }
    },
    ...(options.maxCases ? { maxCases: options.maxCases } : {})
  });
}

/** Operator verification through the script: challenge, the "mail" (returned address), then proof. */
export async function verifyCase(reference: string, expectedAddress: string) {
  const started = await operator('start-verification', reference);
  if (started['status'] !== 'ok' || started['address'] !== expectedAddress.toLowerCase())
    throw new Error('verification did not start for the address on file');
  const confirmed = await operator(
    'confirm-proof',
    reference,
    '--code',
    String(started['code']),
    '--confirm'
  );
  if (confirmed['status'] !== 'ok') throw new Error('proof rejected');
}

/** Dry-run, then arm the approved plan unchanged for the local project. */
export async function armCase(reference: string, successors: Record<string, unknown> = {}) {
  const dry = await operator('dry-run', reference, '--successors', JSON.stringify(successors));
  const { blockers: _blockers, ...plan } = asRecord(dry['plan']);
  const armed = await operator('arm', reference, '--plan', JSON.stringify(plan));
  if (armed['status'] !== 'ok') throw new Error('arm rejected: ' + String(armed['code']));
  return plan;
}

/** Rows of every privacy_internal table that still mention the needle (ids, emails, anything). */
export async function privacyTablesMentioning(needle: string) {
  const rows = await sqlRows(
    "select c.relname::text as relname, (xpath('/row/n/text()', query_to_xml(" +
      "format('select count(*) as n from privacy_internal.%I t where t::text like %L', c.relname, " +
      L('%' + needle + '%') +
      "), false, true, '')))[1]::text::int as n from pg_class c where c.relnamespace = 'privacy_internal'::regnamespace and c.relkind = 'r' order by 1"
  );
  return rows.filter((row) => Number(row['n']) > 0).map((row) => String(row['relname']));
}

export async function storageNames(subject: string) {
  const rows = await sqlRows(
    'select bucket_id::text || ' +
      "'/'" +
      ' || name as name from privacy_internal.erasure_storage_objects(' +
      L(subject) +
      ') order by 1'
  );
  return rows.map((row) => String(row['name']));
}

export const objectExists = async (bucket: string, name: string) =>
  Number(
    await scalar(
      'select count(*)::int from storage.objects where bucket_id = ' +
        L(bucket) +
        ' and name = ' +
        L(name)
    )
  ) === 1;

export async function uploadObject(bucket: string, name: string, contentType: string) {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const { error } = await trustedClient().storage.from(bucket).upload(name, bytes, { contentType });
  if (error) throw new Error('fixture upload failed');
}

/**
 * Admin client that runs the real Auth admin API but lets a test act in the middle of a phase: after the ban is
 * applied (a concurrent change), or with the ban lift failing (a provider outage).
 */
export function scriptedAdmin(hooks: {
  afterBan?: (id: string) => Promise<void>;
  unbanError?: boolean;
}): AdminClient {
  const real = trustedClient();
  const wrapper = {
    rpc: (name: string, args: Record<string, unknown>) => real.rpc(name, args),
    storage: real.storage,
    auth: {
      admin: {
        updateUserById: async (id: string, attributes: { ban_duration?: string }) => {
          if (attributes.ban_duration === 'none' && hooks.unbanError)
            return { data: { user: null }, error: { status: 500, message: 'outage' } };
          const result = await real.auth.admin.updateUserById(id, attributes);
          if (attributes.ban_duration && attributes.ban_duration !== 'none')
            await hooks.afterBan?.(id);
          return result;
        },
        getUserById: real.auth.admin.getUserById.bind(real.auth.admin),
        deleteUser: real.auth.admin.deleteUser.bind(real.auth.admin)
      }
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow double: only the calls the processor makes
  return wrapper as unknown as AdminClient;
}

type Faults = { removeFails?: number; deleteUserFails?: number; finishFails?: number };

/** Admin client whose Storage remove / Auth delete fail a set number of times (provider outage). */
export function faultyAdmin(faults: Faults): AdminClient {
  const real = trustedClient();
  const state = {
    remove: faults.removeFails ?? 0,
    deleteUser: faults.deleteUserFails ?? 0,
    finish: faults.finishFails ?? 0
  };
  const wrapper = {
    // Finish is the last RPC of a case: an outage there must quarantine it, not loop forever.
    rpc: (name: string, args: Record<string, unknown>) =>
      name === 'privacy_proc_finish' && state.finish-- > 0
        ? Promise.resolve({ data: null, error: { message: 'outage' } })
        : real.rpc(name, args),
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) =>
          state.remove-- > 0
            ? Promise.resolve({ data: null, error: { message: 'outage' } })
            : real.storage.from(bucket).remove(names)
      })
    },
    auth: {
      admin: {
        updateUserById: real.auth.admin.updateUserById.bind(real.auth.admin),
        getUserById: real.auth.admin.getUserById.bind(real.auth.admin),
        deleteUser: (id: string, soft?: boolean) =>
          state.deleteUser-- > 0
            ? Promise.resolve({ data: { user: null }, error: { status: 500, message: 'outage' } })
            : real.auth.admin.deleteUser(id, soft)
      }
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow double: only the calls the processor makes
  return wrapper as unknown as AdminClient;
}
