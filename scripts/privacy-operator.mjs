import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Scoped privacy-request operator command (PAF-199 unit C). Trusted operator only: it uses the
// service-role key from the operator's own environment, never a browser route and never a public
// endpoint. Nothing here sends mail: the operator emails the challenge code THEMSELVES from the
// operator mailbox to the Auth-verified address printed by start-verification. The code is shown once
// on this console; only its digest and expiry are stored.

export const HELP = [
  'Usage: pnpm privacy:operator <command> [reference] [options]',
  '',
  'Commands:',
  '  list                                   open cases (state, phase, blocker codes only)',
  '  start-verification <ref>               issue a challenge; prints the code ONCE and the address on file',
  '  confirm-proof <ref> --code <code> --confirm   verify the challenge the requester returned',
  '  dry-run <ref> [--successors <json>]    read-only erasure plan (counts, blockers, revision, fingerprint)',
  '  arm <ref> --plan <json|file>           bind a one-use approval to the dry-run plan and this project',
  '  retry <ref>                            resume a blocked case from its last committed phase',
  '  refuse <ref>                           close a case that has not started (refusal)',
  '  record-response <ref> [--ack-external-followup]',
  '                                         record the final mail sent (purge after 90 days); a case with outstanding',
  '                                         external sends (list: external_followup) needs the explicit acknowledgment',
  '                                         that you verified and mentioned them in the response.',
  '  purge                                  purge expired case records to outcome counts',
  '  switch <intake|executor> <on|off>      fail-closed kill switch',
  '  restore-gate begin --snapshot-at <iso> --cutoff-xid <n>   (both captured at DUMP START by takeSnapshot)',
  '                                         ISOLATED restore target only (never production; the database must be flagged',
  '                                         app.restore_target by the restore flow): derives the expected subjects (live in',
  '                                         the restored copy, gone from the source project given by PRIVACY_SOURCE_SUPABASE_URL',
  '                                         / PRIVACY_SOURCE_SERVICE_ROLE_KEY) and proves it by count parity with the source',
  '                                         erasure events recorded after the snapshot (mismatch: refused, escalate). Re-run after',
  '                                         late erasures to extend the open gate.',
  '  restore-gate clear --evidence <ref>    needs EVERY expected subject reconciled, count parity again, AND an evidence reference.',
  '  ack-external-followup <ref>            acknowledge outstanding external sends (list: external_followup); needs a completed',
  '                                         sweep-remnants first; unblocks the case',
  '  sweep-remnants <ref>                   open case after the freeze: delete invite-shell Auth users created after it for the',
  '                                         erased address (invited, never signed in, no profile); others untouched',
  "  restore-reconcile <subject-id>         restore target only: remove the subject's objects through the Storage API,",
  '                                         replay the real erasure and prove zero residue. Only expected subjects.',
  '  generate-code                          one-time code for an email challenge to an unclaimed person (not stored)',
  '  erase-unclaimed <email> [--confirm] [--all-matches]',
  '                                         erase an add-by-email invitation record that has no account; without',
  '                                         --confirm it only reports counts. Verify the address by challenge first.',
  '',
  'Environment (fail closed when missing):',
  '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   target project (service role: handle as a production secret)',
  '  PRIVACY_OPERATOR_ALLOWED_PROJECTS         comma list of allowed project refs (default: local)',
  '  Non-local projects also need --allow-production and PRIVACY_OPERATOR_PRODUCTION_EVIDENCE.',
  '',
  'Operator responsibility: use a machine and mailbox protected by MFA; never forward the code or',
  'paste it into tickets; never solicit passwords or routine ID copies.'
].join('\n');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const COMMANDS = [
  'list',
  'start-verification',
  'confirm-proof',
  'dry-run',
  'arm',
  'retry',
  'refuse',
  'record-response',
  'purge',
  'switch',
  'generate-code',
  'erase-unclaimed',
  'restore-gate',
  'restore-reconcile',
  'ack-external-followup',
  'sweep-remnants'
];

/** Loopback instances are the 'local' project; a hosted project is the first host label. */
export function projectRefOf(url) {
  if (typeof url !== 'string' || !URL.canParse(url)) return null;
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return 'local';
  return host.split('.')[0] || null;
}

/** Short single-use code: 10 characters of a confusion-free alphabet (about 49 bits). */
export function generateChallenge() {
  let code = '';
  for (let index = 0; index < 10; index++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Digest bound to the case reference: a code issued for one case never verifies another. */
export function challengeDigest(reference, code) {
  const hex = createHash('sha256')
    .update(reference + ':' + String(code).trim().toUpperCase())
    .digest('hex');
  return '\\x' + hex;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new Error('UNKNOWN_COMMAND');
  const positional = [];
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (
        [
          'confirm',
          'allow-production',
          'all-matches',
          'ack-external-followup',
          'resolve-non-shell'
        ].includes(key)
      )
        options[key] = true;
      else options[key] = rest[++index];
    } else positional.push(token);
  }
  return { command, positional, options };
}

const RESTORE_COMMANDS = ['restore-gate', 'restore-reconcile'];
const RESTORE_BUCKETS = ['player-avatars', 'match-event-photos', 'community-venue-photos'];

/** Fail closed: no default project, an explicit allowlist, and production only with evidence. */
export function resolveTarget(env, options = {}, command) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('OPERATOR_CONFIG_MISSING');
  const projectRef = projectRefOf(url);
  if (!projectRef) throw new Error('OPERATOR_PROJECT_UNKNOWN');
  // Restore reconciliation erases people from the database it runs against: only an isolated (local) copy may be
  // its target. This is decided before the allowlist and before any --allow-production override.
  if (RESTORE_COMMANDS.includes(command) && projectRef !== 'local')
    throw new Error('OPERATOR_RESTORE_PRODUCTION_REFUSED');
  const allowed = (env.PRIVACY_OPERATOR_ALLOWED_PROJECTS ?? 'local')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!allowed.includes(projectRef)) throw new Error('OPERATOR_PROJECT_NOT_ALLOWED');
  if (projectRef !== 'local') {
    if (!options['allow-production']) throw new Error('OPERATOR_PRODUCTION_FLAG_REQUIRED');
    if (!env.PRIVACY_OPERATOR_PRODUCTION_EVIDENCE)
      throw new Error('OPERATOR_PRODUCTION_EVIDENCE_MISSING');
  }
  return {
    url,
    key,
    projectRef,
    environment: projectRef === 'local' ? 'local' : 'production'
  };
}

/** The project the restored copy is compared with (read-only use): allowlisted, production only with evidence. */
export function resolveSource(env, options = {}) {
  const url = env.PRIVACY_SOURCE_SUPABASE_URL;
  const key = env.PRIVACY_SOURCE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('OPERATOR_SOURCE_MISSING');
  const projectRef = projectRefOf(url);
  if (!projectRef) throw new Error('OPERATOR_PROJECT_UNKNOWN');
  const allowed = (env.PRIVACY_OPERATOR_ALLOWED_PROJECTS ?? 'local')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!allowed.includes(projectRef)) throw new Error('OPERATOR_PROJECT_NOT_ALLOWED');
  if (projectRef !== 'local') {
    if (!options['allow-production']) throw new Error('OPERATOR_PRODUCTION_FLAG_REQUIRED');
    if (!env.PRIVACY_OPERATOR_PRODUCTION_EVIDENCE)
      throw new Error('OPERATOR_PRODUCTION_EVIDENCE_MISSING');
  }
  return { url, key, projectRef };
}

/** Subjects live in the restored copy but gone from the source project: erased after the snapshot. */
export function deriveExpectedSubjects({ restored, live }) {
  const present = new Set(live);
  return [...new Set(restored)].filter((id) => !present.has(id)).sort((a, b) => a.localeCompare(b));
}

function plainObject(value, code) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value;
}

function readJson(source, code) {
  const text = source.trim().startsWith('{') ? source : readFileSync(source, 'utf8');
  try {
    return plainObject(JSON.parse(text), code);
  } catch {
    throw new Error(code);
  }
}

async function call(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error('OPERATOR_RPC_FAILED');
  return data;
}

function idList(value) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
    throw new Error('OPERATOR_RESPONSE_INVALID');
  return value;
}

function refuseRestoreOnProduction(target) {
  if (target.environment === 'production' || target.projectRef !== 'local')
    throw new Error('OPERATOR_RESTORE_PRODUCTION_REFUSED');
}

const AVATAR_BUCKET = 'player-avatars';

const AVATAR_PAGE = 1000;
const AVATAR_MAX = 10_000;

/**
 * Objects under the subject's avatar prefix, as 'bucket/name' paths (orphans included). When every page up to the
 * bound is full the listing is NOT complete: the caller must refuse (LIST_OVERFLOW), never proceed on a prefix.
 */
async function listAvatarPrefix(client, subject) {
  const paths = [];
  for (let offset = 0; offset < AVATAR_MAX; offset += AVATAR_PAGE) {
    const { data, error } = await client.storage
      .from(AVATAR_BUCKET)
      .list(subject, { limit: AVATAR_PAGE, offset });
    if (error) throw new Error('RESTORE_STORAGE_UNVERIFIED');
    const names = (data ?? []).map((object) => object.name);
    paths.push(...names.map((name) => AVATAR_BUCKET + '/' + subject + '/' + name));
    if (names.length < AVATAR_PAGE) return { complete: true, paths };
  }
  return { complete: false, paths };
}

/** Whether one 'bucket/name' path still resolves in Storage. */
async function stillListed(client, path) {
  const bucket = path.slice(0, path.indexOf('/'));
  const name = path.slice(path.indexOf('/') + 1);
  const slash = name.lastIndexOf('/');
  const base = name.slice(slash + 1);
  const { data, error } = await client.storage
    .from(bucket)
    .list(slash < 0 ? '' : name.slice(0, slash), { search: base });
  if (error) throw new Error('RESTORE_STORAGE_UNVERIFIED');
  return (data ?? []).some((object) => object.name === base);
}

/**
 * Restore reconciliation of ONE expected subject in the restored environment, in two proven storage phases and the
 * database replay. (1) The avatar prefix is listed through the Storage API and sent with the request: the database
 * builds the deletion plan (restored pointers + that listing, so detached orphans are covered). (2) Exactly the plan
 * is deleted in bounded batches, the prefix and every plan path are listed again, and the database accepts the
 * confirmation only when the deleted set equals the plan and nothing is left. Only then does the erasure replay
 * run. Every refusal (isolation flag, gate, project, expected set) comes from the database before anything is deleted.
 */
export async function reconcileRestoredSubject(client, subject, projectRef) {
  const prefix = await listAvatarPrefix(client, subject);
  // An overflowing listing cannot prove the plan complete: refuse before any plan exists.
  if (!prefix.complete) return { status: 'rejected', code: 'LIST_OVERFLOW' };
  const planned = plainObject(
    await call(client, 'privacy_op_restore_storage_set', {
      p_subject: subject,
      p_project_ref: projectRef,
      p_prefix_paths: prefix.paths
    }),
    'OPERATOR_RESPONSE_INVALID'
  );
  if (planned.status !== 'ok') return planned;
  const plan = Array.isArray(planned.plan) ? planned.plan : [];
  const byBucket = new Map();
  for (const path of plan) {
    const bucket = typeof path === 'string' ? path.slice(0, path.indexOf('/')) : '';
    if (!RESTORE_BUCKETS.includes(bucket)) throw new Error('RESTORE_STORAGE_BUCKET_REJECTED');
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path.slice(bucket.length + 1)]);
  }
  for (const [bucket, names] of byBucket) {
    for (let index = 0; index < names.length; index += 100) {
      const { error } = await client.storage.from(bucket).remove(names.slice(index, index + 100));
      if (error) throw new Error('RESTORE_STORAGE_REMOVE_FAILED');
    }
  }
  const after = await listAvatarPrefix(client, subject);
  // The proof of absence needs a complete listing too (the deletion already ran; the operator re-runs after cleanup).
  if (!after.complete) return { status: 'rejected', code: 'LIST_OVERFLOW' };
  const relisted = new Set(after.paths);
  for (const path of plan) if (await stillListed(client, path)) relisted.add(path);
  const confirmed = plainObject(
    await call(client, 'privacy_op_restore_storage_confirm', {
      p_subject: subject,
      p_project_ref: projectRef,
      p_deleted_paths: plan,
      p_relisted_paths: [...relisted]
    }),
    'OPERATOR_RESPONSE_INVALID'
  );
  if (confirmed.status !== 'ok') return confirmed;
  return call(client, 'privacy_op_restore_reconcile', {
    p_subject: subject,
    p_project_ref: projectRef
  });
}

/**
 * Deletes invite-shell Auth users that a send admitted before the freeze created for the erased address afterwards.
 * Only users created after the freeze whose address digest matches the case, that were invited and never signed in
 * and have no profile are removed; everyone else is left alone. Console output holds counts and safe codes only.
 */
export async function sweepRemnants(
  client,
  reference,
  { perPage = 200, maxPages = 100, maxPasses = 10, resolveNonShell = false } = {}
) {
  const context = plainObject(
    await call(client, 'privacy_op_remnant_context', { p_reference: reference }),
    'OPERATOR_RESPONSE_INVALID'
  );
  if (context.status !== 'ok') return context;
  const since = Date.parse(String(context.since));
  let removedTotal = 0;
  let scanned = 0;
  // Offset pagination shifts under deletion (later users move to earlier offsets): any pass that deleted something is
  // repeated from the start, and completion is only a pass that deleted nothing AND ended on a non-full page.
  for (let pass = 0; pass < maxPasses; pass++) {
    scanned = 0;
    let matched = 0;
    let nonShell = 0;
    let deletions = 0;
    let reachedEnd = false;
    for (let page = 1; page <= maxPages; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error('REMNANT_LIST_FAILED');
      const users = data?.users ?? [];
      for (const user of users) {
        scanned += 1;
        if (!user.email || !(Date.parse(user.created_at) > since)) continue;
        const digest = createHash('sha256').update(user.email.toLowerCase()).digest('hex');
        if (digest !== context.digest) continue;
        matched += 1;
        const shell = plainObject(
          await call(client, 'privacy_op_remnant_is_shell', { p_user: user.id }),
          'OPERATOR_RESPONSE_INVALID'
        );
        if (shell.shell !== true) {
          // A real account with the erased address (profile or sign-in) is never deleted, and never ignored silently.
          nonShell += 1;
          continue;
        }
        const { error: deleteError } = await client.auth.admin.deleteUser(user.id, false);
        if (deleteError) throw new Error('REMNANT_DELETE_FAILED');
        deletions += 1;
        removedTotal += 1;
      }
      if (users.length < perPage) {
        reachedEnd = true;
        break;
      }
    }
    // The page cap was hit on a full page: unscanned users may remain. Fail closed, record nothing.
    if (!reachedEnd) return { status: 'incomplete', code: 'SWEEP_INCOMPLETE', scanned };
    if (deletions === 0 && nonShell > 0 && !resolveNonShell) {
      return {
        status: 'matched_non_shell',
        code: 'MATCHED_NON_SHELL',
        matchedNonShell: nonShell,
        scanned,
        hint: 'A real account holds the erased address: resolve it, then repeat with --resolve-non-shell to record the sweep.'
      };
    }
    if (deletions === 0) {
      // A complete, deletion-free pass: only now is the sweep recorded on the case.
      await call(client, 'privacy_op_remnants_swept', { p_reference: reference });
      return {
        status: 'ok',
        code: removedTotal > 0 ? 'REMNANTS_REMOVED' : 'NO_REMNANTS',
        scanned,
        matched,
        removed: removedTotal
      };
    }
  }
  return { status: 'incomplete', code: 'SWEEP_INCOMPLETE', scanned };
}

/** Executes one parsed command against a service-role client. Returns console-safe data. */
export async function runCommand(client, parsed, target, source) {
  const { command, positional, options } = parsed;
  const reference = positional[0];
  const referenceless = [
    'list',
    'purge',
    'switch',
    'generate-code',
    'erase-unclaimed',
    'restore-gate'
  ];
  if (!referenceless.includes(command) && !reference) throw new Error('REFERENCE_REQUIRED');
  switch (command) {
    case 'list':
      return call(client, 'privacy_op_list_cases', {});
    case 'start-verification': {
      const code = generateChallenge();
      const result = plainObject(
        await call(client, 'privacy_op_start_verification', {
          p_reference: reference,
          p_digest: challengeDigest(reference, code),
          p_ttl_seconds: 1800
        }),
        'OPERATOR_RESPONSE_INVALID'
      );
      // The code leaves this process only on the operator console, once.
      return result.status === 'ok' ? { ...result, code } : result;
    }
    case 'confirm-proof': {
      if (!options.code) throw new Error('CODE_REQUIRED');
      return call(client, 'privacy_op_confirm_proof', {
        p_reference: reference,
        p_digest: challengeDigest(reference, options.code),
        p_operator_confirmed: options.confirm === true
      });
    }
    case 'dry-run':
      return call(client, 'privacy_op_dry_run', {
        p_reference: reference,
        p_successors: options.successors ? readJson(options.successors, 'SUCCESSORS_INVALID') : {}
      });
    case 'arm': {
      if (!options.plan) throw new Error('PLAN_REQUIRED');
      const parsedPlan = readJson(options.plan, 'PLAN_INVALID');
      // Accept either the dry-run envelope ({status, plan}) or the bare plan.
      const plan = parsedPlan.plan ? plainObject(parsedPlan.plan, 'PLAN_INVALID') : parsedPlan;
      return call(client, 'privacy_op_arm', {
        p_reference: reference,
        p_expected: plan,
        p_project_ref: target.projectRef,
        p_environment: target.environment
      });
    }
    case 'retry': {
      const result = plainObject(
        await call(client, 'privacy_op_retry', { p_reference: reference }),
        'OPERATOR_RESPONSE_INVALID'
      );
      if (result.status !== 'ban_lift_required') return result;
      // A stale-verification abort could not lift its temporary ban: lift it here, then the case is restartable.
      const { error } = await client.auth.admin.updateUserById(String(result.subject_id), {
        ban_duration: 'none'
      });
      if (error && error.status !== 404) return { status: 'rejected', code: 'BAN_LIFT_FAILED' };
      return call(client, 'privacy_op_ban_lift_done', { p_reference: reference });
    }
    case 'ack-external-followup':
      return call(client, 'privacy_op_ack_external_followup', { p_reference: reference });
    case 'sweep-remnants':
      return sweepRemnants(client, reference, {
        resolveNonShell: options['resolve-non-shell'] === true
      });
    case 'refuse':
      return call(client, 'privacy_op_close_refused', { p_reference: reference });
    case 'record-response': {
      const result = plainObject(
        await call(client, 'privacy_op_record_response', {
          p_reference: reference,
          p_external_followup_ack: options['ack-external-followup'] === true
        }),
        'OPERATOR_RESPONSE_INVALID'
      );
      return result.code === 'EXTERNAL_FOLLOWUP_ACK_REQUIRED'
        ? {
            ...result,
            hint: 'Verify and mention the outstanding sends in the final response, then repeat with --ack-external-followup.'
          }
        : result;
    }
    case 'purge':
      return call(client, 'privacy_op_purge_expired', {});
    case 'restore-gate': {
      refuseRestoreOnProduction(target);
      const [action] = positional;
      if (!['begin', 'clear'].includes(action)) throw new Error('RESTORE_GATE_ACTION_INVALID');
      if (!source) throw new Error('OPERATOR_SOURCE_MISSING');
      const erasuresSince = async (cutoffXid, instant) =>
        Number(
          plainObject(
            await call(source, 'privacy_op_erasure_count_since', {
              p_cutoff_xid: cutoffXid,
              p_cutoff_time: instant
            }),
            'OPERATOR_RESPONSE_INVALID'
          ).count
        );
      if (action === 'clear') {
        // Parity once more at the end: erasures made while reconciling force a re-derivation (restore-gate begin).
        const status = plainObject(
          await call(client, 'privacy_op_restore_gate_status', {}),
          'OPERATOR_RESPONSE_INVALID'
        );
        if (!status.snapshot_at) throw new Error('RESTORE_GATE_NOT_BEGUN');
        const cleared = plainObject(
          await call(client, 'privacy_op_restore_gate', {
            p_action: 'clear',
            p_evidence: options.evidence ?? null,
            p_tombstone_count: await erasuresSince(
              Number(status.cutoff_xid),
              new Date(String(status.snapshot_at)).toISOString()
            )
          }),
          'OPERATOR_RESPONSE_INVALID'
        );
        return cleared.code === 'COUNT_MISMATCH'
          ? {
              ...cleared,
              hint: 'Erasures were made after the set was derived: repeat restore-gate begin with the same --snapshot-at, reconcile the new subjects, then clear.'
            }
          : cleared;
      }
      const snapshotAt = options['snapshot-at'];
      if (!snapshotAt || Number.isNaN(Date.parse(snapshotAt)))
        throw new Error('SNAPSHOT_AT_REQUIRED');
      const since = new Date(snapshotAt).toISOString();
      const cutoffXid = Number(options['cutoff-xid']);
      if (!Number.isSafeInteger(cutoffXid) || cutoffXid < 0) throw new Error('CUTOFF_XID_REQUIRED');
      const restored = idList(await call(client, 'privacy_op_live_identity_ids', {}));
      const live = idList(await call(source, 'privacy_op_live_identity_ids', {}));
      // The set is the difference (closed case records keep no subject id); its size must equal the identity-free erasure events the
      // erasures left after the snapshot, which the database checks (COUNT_MISMATCH: fail closed, escalate).
      return call(client, 'privacy_op_restore_gate', {
        p_action: 'begin',
        p_evidence: null,
        p_snapshot_at: since,
        p_expected_subjects: deriveExpectedSubjects({ restored, live }),
        p_restore_project_ref: target.projectRef,
        p_tombstone_count: await erasuresSince(cutoffXid, since),
        p_cutoff_xid: cutoffXid
      });
    }
    case 'restore-reconcile':
      // The subject id is the operator's own post-snapshot erasure record; it is never echoed back.
      refuseRestoreOnProduction(target);
      return reconcileRestoredSubject(client, reference, target.projectRef);
    case 'generate-code':
      // Printed once for the operator's own email challenge; nothing is stored or sent from here.
      return { status: 'ok', code: generateChallenge() };
    case 'erase-unclaimed': {
      const email = positional[0];
      if (!email) throw new Error('EMAIL_REQUIRED');
      // The address is sent to the database and never echoed, logged or stored by this script.
      return call(client, 'privacy_op_erase_unclaimed', {
        p_email: email,
        p_confirm: options.confirm === true,
        p_all_matches: options['all-matches'] === true
      });
    }
    case 'switch': {
      const [key, value] = positional;
      if (!['intake', 'executor'].includes(key) || !['on', 'off'].includes(value))
        throw new Error('SWITCH_INVALID');
      return call(client, 'privacy_op_set_switch', {
        p_key: key + '_enabled',
        p_value: value === 'on'
      });
    }
    default:
      throw new Error('UNKNOWN_COMMAND');
  }
}

export async function main(argv, env) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
    console.log(HELP);
    return 0;
  }
  const parsed = parseArgs(argv);
  const target = resolveTarget(env, parsed.options, parsed.command);
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  const client = createClient(target.url, target.key, clientOptions);
  let source;
  if (parsed.command === 'restore-gate') {
    const resolved = resolveSource(env, parsed.options);
    if (resolved.url === target.url) throw new Error('OPERATOR_RESTORE_SOURCE_IS_TARGET');
    source = createClient(resolved.url, resolved.key, clientOptions);
  }
  console.log(JSON.stringify(await runCommand(client, parsed, target, source), null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (error) => {
      // Fixed codes only: provider and SQL text never reach the console.
      console.error(
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : 'OPERATOR_FAILED'
      );
      process.exit(1);
    }
  );
}
