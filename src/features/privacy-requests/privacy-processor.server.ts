import { emitDiagnostic } from '../../lib/diagnostics.server';
import { getAdminClient, type AdminClient } from '../../lib/supabase/admin.server';
import { nextPhase, type PrivacyCaseState, type PrivacyPhase } from './privacy-request-model';

/** Buckets the processor may touch. Anything else is never listed, never removed. */
export const PRIVACY_STORAGE_BUCKETS = [
  'player-avatars',
  'match-event-photos',
  'community-venue-photos'
] as const;
const STORAGE_BATCH = 100;
const STORAGE_PASSES = 20;
const LEASE_SECONDS = 120;
const BAN_DURATION = '876000h';

export type PrivacyStep = PrivacyPhase | 'finish';

/** Test seam: a hook that throws simulates a worker crash at that boundary (no fail record is written). */
export type PrivacyProcessorHooks = {
  beforeStep?: (step: PrivacyStep) => Promise<void> | void;
  afterStep?: (step: PrivacyStep) => Promise<void> | void;
};

export type PrivacyClaim = {
  case_id: string;
  fence: number;
  lease_token: string;
  state: PrivacyCaseState;
  last_phase: PrivacyPhase | null;
  subject_id: string;
};
export type PrivacyRunResult =
  | { status: 'closed'; steps: PrivacyStep[] }
  | { status: 'blocked'; code: string; steps: PrivacyStep[] }
  | { status: 'retry'; steps: PrivacyStep[] }
  | { status: 'fenced'; steps: PrivacyStep[] };

class LeaseLost extends Error {
  constructor() {
    super('PRIVACY_LEASE_LOST');
  }
}

/** Loopback instances are the 'local' project; a hosted project is the first host label. */
export function projectRefOf(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return 'local';
  return host.split('.')[0] || null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

async function rpc(
  admin: AdminClient,
  name:
    | 'privacy_proc_claim'
    | 'privacy_proc_freeze'
    | 'privacy_proc_erase_relational'
    | 'privacy_proc_storage_set'
    | 'privacy_proc_complete_phase'
    | 'privacy_proc_finish'
    | 'privacy_proc_fail'
    | 'privacy_op_purge_expired',
  args: Record<string, unknown>
): Promise<unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RPC names are a closed union and the args are built by this module
  const { data, error } = await admin.rpc(name, args as never);
  if (error) {
    if (error.message === 'PRIVACY_LEASE_LOST') throw new LeaseLost();
    throw new Error('PRIVACY_RPC_FAILED');
  }
  return data;
}

function isNotFound(error: { status?: number; code?: string } | null): boolean {
  return !!error && (error.status === 404 || error.code === 'user_not_found');
}

export function parseClaim(value: unknown): PrivacyClaim | { status: 'blocked' } | null {
  const row = record(value);
  if (!row) return null;
  if (row.status === 'blocked') return { status: 'blocked' };
  if (
    row.status !== 'claimed' ||
    typeof row.case_id !== 'string' ||
    typeof row.fence !== 'number' ||
    typeof row.lease_token !== 'string' ||
    typeof row.subject_id !== 'string' ||
    (row.state !== 'executing' &&
      row.state !== 'app_data_erased' &&
      row.state !== 'supabase_erased')
  )
    return null;
  const phase = row.last_phase;
  const lastPhase =
    phase === 'freeze' || phase === 'relational' || phase === 'storage' || phase === 'auth'
      ? phase
      : null;
  return {
    case_id: row.case_id,
    fence: row.fence,
    lease_token: row.lease_token,
    state: row.state,
    last_phase: lastPhase,
    subject_id: row.subject_id
  };
}

async function removeStorage(admin: AdminClient, claim: PrivacyClaim): Promise<number> {
  const keys = { p_case: claim.case_id, p_fence: claim.fence, p_token: claim.lease_token };
  let removed = 0;
  for (let pass = 0; pass < STORAGE_PASSES; pass++) {
    const listed = await rpc(admin, 'privacy_proc_storage_set', { ...keys, p_limit: 200 });
    const objects = (Array.isArray(listed) ? listed : []).flatMap((entry) => {
      const row = record(entry);
      return row && typeof row.bucket === 'string' && typeof row.name === 'string'
        ? [{ bucket: row.bucket, name: row.name }]
        : [];
    });
    if (objects.length === 0) return removed;
    const byBucket = new Map<string, string[]>();
    for (const object of objects) {
      // Allowlist: the SQL set is already bucket-bound; refuse anything else defensively.
      if (!PRIVACY_STORAGE_BUCKETS.some((bucket) => bucket === object.bucket)) {
        throw new Error('STORAGE_BUCKET_REJECTED');
      }
      byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.name]);
    }
    for (const [bucket, names] of byBucket) {
      for (let index = 0; index < names.length; index += STORAGE_BATCH) {
        const batch = names.slice(index, index + STORAGE_BATCH);
        const { error } = await admin.storage.from(bucket).remove(batch);
        if (error) throw new Error('STORAGE_REMOVE_FAILED');
        removed += batch.length;
      }
    }
  }
  // The set never emptied: the Storage API did not remove the bytes.
  throw new Error('STORAGE_RESIDUE');
}

async function eraseAuthUser(admin: AdminClient, subject: string): Promise<void> {
  const before = await admin.auth.admin.getUserById(subject);
  if (before.error && !isNotFound(before.error)) throw new Error('AUTH_UNVERIFIED');
  if (!before.error) {
    const { error } = await admin.auth.admin.deleteUser(subject, false);
    if (error && !isNotFound(error)) throw new Error('AUTH_DELETE_FAILED');
  }
  // Absence must be proven: only a not-found answer is success. An ambiguous answer is a retry.
  const after = await admin.auth.admin.getUserById(subject);
  if (!isNotFound(after.error)) throw new Error('AUTH_UNVERIFIED');
}

const FAIL_CODE = {
  freeze: 'FREEZE_FAILED',
  relational: 'SEAM_FAILED',
  storage: 'STORAGE_FAILED',
  auth: 'AUTH_DELETE_FAILED',
  finish: 'SEAM_FAILED'
} as const;

/** Runs one claimed case from its last committed phase. A completed phase is never repeated. */
export async function processPrivacyCase(
  admin: AdminClient,
  claim: PrivacyClaim,
  hooks: PrivacyProcessorHooks = {}
): Promise<PrivacyRunResult> {
  const keys = { p_case: claim.case_id, p_fence: claim.fence, p_token: claim.lease_token };
  const steps: PrivacyStep[] = [];
  let state = claim.state;
  let lastPhase = claim.last_phase;
  for (let guard = 0; guard < 8; guard++) {
    const step = nextPhase(state, lastPhase);
    if (!step) return { status: 'retry', steps };
    await hooks.beforeStep?.(step);
    try {
      if (step === 'freeze') {
        // The verified address must still be the one on file BEFORE anything locks the person out: a stale
        // proof blocks the case (verification restarts) without a ban.
        const precheck = record(
          await rpc(admin, 'privacy_proc_freeze', { ...keys, p_check_only: true })
        );
        if (precheck?.status === 'blocked') {
          emitDiagnostic('privacy.case', 'rejected', { stage: step, code: String(precheck.code) });
          return { status: 'blocked', code: String(precheck.code), steps };
        }
        // Sessions cannot be listed through the admin API: banning stops refresh and sign-in, and the
        // database freeze (committed next) rejects every stale access token at each boundary.
        const { error } = await admin.auth.admin.updateUserById(claim.subject_id, {
          ban_duration: BAN_DURATION
        });
        if (error && !isNotFound(error)) throw new Error('FREEZE_FAILED');
        const frozen = record(await rpc(admin, 'privacy_proc_freeze', keys));
        if (frozen?.status === 'blocked') {
          // The address moved between the pre-check and the freeze: nothing destructive happened, lift the ban.
          await admin.auth.admin.updateUserById(claim.subject_id, { ban_duration: 'none' });
          emitDiagnostic('privacy.case', 'rejected', { stage: step, code: String(frozen.code) });
          return { status: 'blocked', code: String(frozen.code), steps };
        }
        lastPhase = 'freeze';
      } else if (step === 'relational') {
        const result = record(await rpc(admin, 'privacy_proc_erase_relational', keys));
        if (result?.status === 'blocked') {
          emitDiagnostic('privacy.case', 'rejected', { stage: step, code: String(result.code) });
          return { status: 'blocked', code: String(result.code), steps };
        }
        // In-flight work of the subject (older transactions, leased push) must settle first: wait, no failure.
        if (result?.status === 'wait') return { status: 'retry', steps };
        if (result?.status === 'retry') throw new Error('SEAM_FAILED');
        state = 'app_data_erased';
        lastPhase = 'relational';
      } else if (step === 'storage') {
        const removed = await removeStorage(admin, claim);
        await rpc(admin, 'privacy_proc_complete_phase', {
          ...keys,
          p_phase: 'storage',
          p_removed: removed
        });
        lastPhase = 'storage';
      } else if (step === 'auth') {
        await eraseAuthUser(admin, claim.subject_id);
        await rpc(admin, 'privacy_proc_complete_phase', { ...keys, p_phase: 'auth', p_removed: 0 });
        state = 'supabase_erased';
        lastPhase = 'auth';
      } else {
        await rpc(admin, 'privacy_proc_finish', keys);
      }
    } catch (error) {
      if (error instanceof LeaseLost) return { status: 'fenced', steps };
      // Only fixed codes are recorded; provider and SQL text never leave this boundary.
      const code =
        error instanceof Error && error.message === 'STORAGE_RESIDUE'
          ? 'STORAGE_RESIDUE'
          : error instanceof Error && error.message === 'AUTH_UNVERIFIED'
            ? 'AUTH_UNVERIFIED'
            : FAIL_CODE[step];
      emitDiagnostic('privacy.case', 'failure', { stage: step, code, retryable: true });
      try {
        await rpc(admin, 'privacy_proc_fail', { ...keys, p_code: code, p_retryable: true });
      } catch (failure) {
        if (failure instanceof LeaseLost) return { status: 'fenced', steps };
      }
      return { status: 'retry', steps };
    }
    steps.push(step);
    emitDiagnostic('privacy.case', 'success', { stage: step });
    await hooks.afterStep?.(step);
    if (step === 'finish') return { status: 'closed', steps };
  }
  return { status: 'retry', steps };
}

export type PrivacySweepOptions = {
  client?: AdminClient;
  env?: Record<string, string | undefined>;
  projectRef?: string;
  hooks?: PrivacyProcessorHooks;
  maxCases?: number;
};

/**
 * Scheduled sweep. It only executes cases an operator armed (or resumes committed ones): there is no
 * HTTP entry, no query-string authentication and no intake here. Disabled by PRIVACY_EXECUTOR_DISABLED=1
 * or by the database kill switch (claim returns nothing).
 */
export async function sweepPrivacyRequestsOnSchedule(options: PrivacySweepOptions = {}) {
  const env = options.env ?? process.env;
  if (env.PRIVACY_EXECUTOR_DISABLED === '1') return { disabled: true as const, processed: 0 };
  const admin = options.client ?? getAdminClient();
  const projectRef = options.projectRef ?? projectRefOf(import.meta.env.VITE_SUPABASE_URL);
  if (!projectRef) throw new Error('PRIVACY_PROJECT_UNAVAILABLE');
  let processed = 0;
  for (let index = 0; index < (options.maxCases ?? 3); index++) {
    const claimed = parseClaim(
      await rpc(admin, 'privacy_proc_claim', {
        p_lease_seconds: LEASE_SECONDS,
        p_project_ref: projectRef
      })
    );
    if (!claimed) break;
    if ('status' in claimed) continue;
    await processPrivacyCase(admin, claimed, options.hooks);
    processed += 1;
  }
  await rpc(admin, 'privacy_op_purge_expired', {});
  return { disabled: false as const, processed };
}
