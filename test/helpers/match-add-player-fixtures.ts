import { execFileSync } from 'node:child_process';
import { AuthApiError, createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/supabase/database.types';
import { deliverMatchPlayerAdd } from '../../src/features/matches/match-add-player.server';
import type { AddMatchPlayerResult } from '../../src/features/matches/match-add-player-model';
import type { LocalSupabaseEnv } from './local-supabase-env';
import type { ProvisionalFixtureActor } from './provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './sql-transport';

/** Allowlisted in supabase/config.toml, like the app origin the server function sends. */
export const INVITE_ORIGIN = 'http://127.0.0.1:3000';

type LocalStatus = { serviceRoleKey: string; mailpitUrl: string };
let status: LocalStatus | undefined;

/** Local-only service role key and Mailpit URL from `supabase status` (never committed). */
function localStatus(): LocalStatus {
  if (status) return status;
  const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const value = (name: string) =>
    output
      .match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
      ?.trim()
      .replace(/^"(.*)"$/, '$1') ?? '';
  status = { serviceRoleKey: value('SERVICE_ROLE_KEY'), mailpitUrl: value('MAILPIT_URL') };
  if (!status.serviceRoleKey || !/^http:\/\/127\.0\.0\.1:\d+$/.test(status.mailpitUrl))
    throw new Error('Local Supabase service role key or Mailpit URL unavailable');
  return status;
}

export function localAdminClient(env: LocalSupabaseEnv): SupabaseClient<Database> {
  return createClient<Database>(env.url, localStatus().serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

/**
 * Service-role client whose Auth invite fails (SMTP down) for the first `failures`
 * calls, then delegates to the real Auth admin API.
 */
export function failingInviteAdmin(env: LocalSupabaseEnv, failures = Infinity) {
  const admin = localAdminClient(env);
  const realInvite = admin.auth.admin.inviteUserByEmail.bind(admin.auth.admin);
  let remaining = failures;
  admin.auth.admin.inviteUserByEmail = async (...args) => {
    if (remaining-- <= 0) return realInvite(...args);
    return {
      data: { user: null },
      error: new AuthApiError('smtp down', 500, 'unexpected_failure')
    };
  };
  return admin;
}

export type AddPlayerInput = {
  eventId: string;
  displayName: string;
  email: string;
  level: number;
  requestId?: string;
  locale?: 'en' | 'pt-BR' | 'es';
};

/** RPC args exactly as the server function sends them. */
export function addPlayerArgs(input: AddPlayerInput) {
  return {
    p_match_event_id: input.eventId,
    p_display_name: input.displayName,
    p_email: input.email,
    p_estimated_level: input.level,
    p_locale: input.locale ?? 'en',
    p_request_id: input.requestId ?? crypto.randomUUID()
  };
}

/**
 * Mirrors addMatchPlayer: the user-scoped command, then the service-role
 * delivery (dispatch -> Auth invite -> settle) for the same actor/request.
 */
export async function addPlayer(
  env: LocalSupabaseEnv,
  actor: ProvisionalFixtureActor,
  input: AddPlayerInput
): Promise<{ command: unknown; result: AddMatchPlayerResult }> {
  const args = addPlayerArgs(input);
  const { data, error } = await actor.client.rpc('add_match_player', args);
  if (error) return { command: error, result: { status: 'error', code: 'unavailable' } };
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'status') !== 'ok')
    return { command: data, result: { status: 'error', code: 'rate_limited' } };
  const result = await deliverMatchPlayerAdd(localAdminClient(env), {
    actor_id: actor.id,
    event_id: input.eventId,
    request_id: args.p_request_id,
    origin: INVITE_ORIGIN
  });
  return { command: data, result };
}

export const uniqueEmail = (label: string) => `add-${label}-${crypto.randomUUID()}@test.local`;

export async function mailCount(email: string): Promise<number> {
  const query = encodeURIComponent(`to:"${email.trim().toLowerCase()}"`);
  const response = await fetch(`${localStatus().mailpitUrl}/api/v1/search?query=${query}`);
  const body: unknown = await response.json();
  const count =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'messages_count') : undefined;
  if (typeof count !== 'number') throw new Error('Unexpected Mailpit search response');
  return count;
}

export type DeliveredMail = { subject: string; html: string };

/** Mail delivered to one recipient (bounded by recipient, never the whole mailbox), oldest first. */
export async function mailFor(email: string): Promise<DeliveredMail[]> {
  const base = localStatus().mailpitUrl;
  const query = encodeURIComponent(`to:"${email.trim().toLowerCase()}"`);
  const search: unknown = await (await fetch(`${base}/api/v1/search?query=${query}`)).json();
  const summaries =
    typeof search === 'object' && search !== null ? Reflect.get(search, 'messages') : undefined;
  if (!Array.isArray(summaries)) throw new Error('Unexpected Mailpit search response');
  const mails: DeliveredMail[] = [];
  for (const summary of [...summaries].reverse()) {
    const message: unknown = await (
      await fetch(`${base}/api/v1/message/${String(Reflect.get(summary, 'ID'))}`)
    ).json();
    const subject = Reflect.get(Object(message), 'Subject');
    const html = Reflect.get(Object(message), 'HTML');
    if (typeof subject !== 'string' || typeof html !== 'string')
      throw new Error('Unexpected Mailpit message response');
    mails.push({ subject, html });
  }
  return mails;
}

export async function authUsersByEmail(email: string) {
  const result = await queryTrustedSql(
    `select id, raw_user_meta_data from auth.users where lower(email) = lower(btrim($1))`,
    { values: [email] }
  );
  return result.rows;
}

export async function operation(actorId: string, eventId: string, requestId: string) {
  const result = await queryTrustedSql(
    `select state, branch, outcome, target_user_id, dispatch_state, email
       from public.match_player_add_operations
      where actor_id = $1 and match_event_id = $2 and request_id = $3`,
    { values: [actorId, eventId, requestId] }
  );
  return result.rows[0];
}

/** Direct fixture edit of immutable event fields (restriction, capacity, cutoff). */
export async function patchFixtureEvent(eventId: string, assignments: string): Promise<void> {
  await executeTrustedSql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
    update public.match_events set ${assignments} where id = '${eventId}';
    alter table public.match_events enable trigger match_event_immutable;
  end $$;`);
}
