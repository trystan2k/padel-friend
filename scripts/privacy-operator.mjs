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
  '  record-response <ref>                  record the final mail sent (purge after 90 days)',
  '  purge                                  purge expired case records to outcome counts',
  '  switch <intake|executor> <on|off>      fail-closed kill switch',
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
  'switch'
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
      if (['confirm', 'allow-production'].includes(key)) options[key] = true;
      else options[key] = rest[++index];
    } else positional.push(token);
  }
  return { command, positional, options };
}

/** Fail closed: no default project, an explicit allowlist, and production only with evidence. */
export function resolveTarget(env, options = {}) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('OPERATOR_CONFIG_MISSING');
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
  return {
    url,
    key,
    projectRef,
    environment: projectRef === 'local' ? 'local' : 'production'
  };
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

/** Executes one parsed command against a service-role client. Returns console-safe data. */
export async function runCommand(client, parsed, target) {
  const { command, positional, options } = parsed;
  const reference = positional[0];
  if (command !== 'list' && command !== 'purge' && command !== 'switch' && !reference)
    throw new Error('REFERENCE_REQUIRED');
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
    case 'retry':
      return call(client, 'privacy_op_retry', { p_reference: reference });
    case 'refuse':
      return call(client, 'privacy_op_close_refused', { p_reference: reference });
    case 'record-response':
      return call(client, 'privacy_op_record_response', { p_reference: reference });
    case 'purge':
      return call(client, 'privacy_op_purge_expired', {});
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
  const target = resolveTarget(env, parsed.options);
  const client = createClient(target.url, target.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  console.log(JSON.stringify(await runCommand(client, parsed, target), null, 2));
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
