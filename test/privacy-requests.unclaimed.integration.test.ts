import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { operator } from './helpers/privacy-request-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { trustedClient } from './helpers/trusted-client';

const environment = localSupabaseEnv();
const L = sqlText;
const unique = () => 'unclaimed-' + crypto.randomUUID() + '@invitee.test';

/**
 * PAF-232 fix: people who exist only as an add-by-email operation (no Auth user) are erased by an automated,
 * service-role-only surface. The mailbox challenge to that address is the operator's own step (runbook §3).
 */
describe.skipIf(!environment.env)(
  'Unclaimed (awaiting identity) erasure',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    let eventId: string;
    const actor = () => kit.players[0]!.id;

    // The add-player tables are not part of the shared fixture cleanup: remove them before the event goes.
    afterAll(async () => {
      await fixtureSql(
        'delete from public.match_player_add_recipient_sends where operation_id in (select id from public.match_player_add_operations where match_event_id = ' +
          L(eventId) +
          ');' +
          'delete from public.match_player_add_throttle_hits where match_event_id = ' +
          L(eventId) +
          ';' +
          'delete from public.match_player_add_operations where match_event_id = ' +
          L(eventId) +
          ';'
      );
    });

    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      eventId = await kit.event();
    });

    /** Seeds one awaiting-identity operation with capability, queued dispatch, send and throttle rows. */
    async function seed(email: string, options: { expired?: boolean; send?: boolean } = {}) {
      const operation = crypto.randomUUID();
      const attempt = crypto.randomUUID();
      const request = crypto.randomUUID();
      await fixtureSql(
        'insert into public.match_player_add_operations(id, match_event_id, actor_id, request_id, fingerprint, email, display_name, estimated_level, locale, state, capability_hash, capability_expires_at, dispatch_state, email_eligible, dispatch_attempt) values (' +
          [
            L(operation),
            L(eventId),
            L(actor()),
            L(request),
            L('fp-' + operation),
            L(email),
            L('Invited ' + operation),
            '3.5',
            L('en'),
            "'awaiting_identity'",
            'public.match_player_add_digest(' + L('cap-' + operation) + ')',
            options.expired ? "now() - interval '1 hour'" : "now() + interval '1 day'",
            "'pending'",
            'true',
            L(attempt)
          ].join(', ') +
          ');' +
          (options.send === false
            ? ''
            : 'insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at) values (public.match_player_add_digest(' +
              L(email) +
              '), ' +
              L(operation) +
              ', now());') +
          "insert into public.match_player_add_throttle_hits(scope, actor_id, match_event_id, request_id, email_digest) values ('recipient', " +
          L(actor()) +
          ', ' +
          L(eventId) +
          ', ' +
          L(request) +
          ', public.match_player_add_digest(' +
          L(email) +
          '));'
      );
      return { operation, attempt, request, name: 'Invited ' + operation };
    }
    const row = async (operation: string) =>
      asRecord(
        (
          await sqlRows(
            'select email, display_name, state, dispatch_state, email_eligible, dispatch_attempt, capability_hash is null as no_capability from public.match_player_add_operations where id = ' +
              L(operation)
          )
        )[0]
      );
    const digestRows = async (email: string) =>
      Number(
        await scalar(
          'select (select count(*) from public.match_player_add_recipient_sends where email_digest = public.match_player_add_digest(' +
            L(email) +
            ')) + (select count(*) from public.match_player_add_throttle_hits where email_digest = public.match_player_add_digest(' +
            L(email) +
            '))'
        )
      );

    it('reports counts without changing anything unless confirmed, then scrubs every trace', async () => {
      const email = unique();
      const { operation, attempt, name } = await seed(email);
      const dry = await operator('erase-unclaimed', email);
      expect(dry).toEqual({
        status: 'ok',
        applied: false,
        operations: 1,
        recipient_sends: 1,
        throttle_hits: 1
      });
      expect(await row(operation)).toMatchObject({
        email,
        display_name: name,
        dispatch_state: 'pending'
      });
      expect(await digestRows(email)).toBe(2);

      const done = await operator('erase-unclaimed', email, '--confirm');
      expect(done).toEqual({
        status: 'ok',
        applied: true,
        operations: 1,
        recipient_sends: 1,
        throttle_hits: 1
      });
      expect(await row(operation)).toMatchObject({
        email: 'redacted',
        display_name: 'redacted',
        state: 'awaiting_identity',
        dispatch_state: 'suppressed',
        email_eligible: false,
        dispatch_attempt: null,
        no_capability: true
      });
      expect(await digestRows(email)).toBe(0);
      expect(await tablesMentioning(email)).toEqual([]);
      expect(await tablesMentioning(name)).toEqual([]);

      // Queued dispatch is fenced: neither the redrive claim nor a late in-flight settle can revive it.
      const claimed = await trustedClient().rpc('claim_match_player_add_redrives', {
        p_limit: 100
      });
      expect(JSON.stringify(claimed.data ?? [])).not.toContain(operation);
      await trustedClient().rpc('settle_match_player_add', {
        p_actor_id: actor(),
        p_match_event_id: eventId,
        p_request_id: (
          await sqlRows(
            'select request_id::text as r from public.match_player_add_operations where id = ' +
              L(operation)
          )
        )[0]!['r'],
        p_delivered: true,
        p_attempt: attempt
      });
      expect(await row(operation)).toMatchObject({
        email: 'redacted',
        dispatch_state: 'suppressed',
        no_capability: true
      });

      // Idempotent: a second confirmed call finds nothing and does not fail.
      expect(await operator('erase-unclaimed', email, '--confirm')).toEqual({
        status: 'ok',
        applied: true,
        operations: 0,
        recipient_sends: 0,
        throttle_hits: 0
      });

      // The same address can sign up later: nothing links it to the erased operation, and no suppression list exists.
      const anon = createClient(environment.env!.url, environment.env!.key, {
        auth: { persistSession: false }
      });
      expect((await anon.auth.signUp({ email, password: 'Password123!' })).error).toBeNull();
      expect(await row(operation)).toMatchObject({ email: 'redacted', state: 'awaiting_identity' });
      expect(
        Number(
          await scalar(
            'select count(*)::int from public.match_event_registrations r join auth.users u on u.id = r.user_id where u.email = ' +
              L(email)
          )
        )
      ).toBe(0);
    });

    it('erases an expired operation the same way', async () => {
      const email = unique();
      const { operation } = await seed(email, { expired: true });
      expect(await operator('erase-unclaimed', email, '--confirm')).toMatchObject({
        status: 'ok',
        operations: 1
      });
      expect(await row(operation)).toMatchObject({ email: 'redacted', no_capability: true });
      expect(await tablesMentioning(email)).toEqual([]);
    });

    it('refuses an address that has an Auth user and changes nothing', async () => {
      const existing = String(
        await scalar('select email from auth.users where id = ' + L(kit.players[1]!.id))
      );
      const { operation } = await seed(existing);
      expect(await operator('erase-unclaimed', existing, '--confirm')).toEqual({
        status: 'refused',
        code: 'ACCOUNT_EXISTS'
      });
      expect(await row(operation)).toMatchObject({
        email: existing.toLowerCase(),
        dispatch_state: 'pending'
      });
    });

    it('fails closed on ambiguity until the operator accepts every match', async () => {
      const email = unique();
      const first = await seed(email);
      const second = await seed(email, { send: false });
      expect(await operator('erase-unclaimed', email, '--confirm')).toEqual({
        status: 'rejected',
        code: 'AMBIGUOUS',
        operations: 2
      });
      expect(await row(first.operation)).toMatchObject({ email });
      expect(await row(second.operation)).toMatchObject({ email });
      expect(await operator('erase-unclaimed', email, '--confirm', '--all-matches')).toMatchObject({
        status: 'ok',
        applied: true,
        operations: 2
      });
      expect(await tablesMentioning(email)).toEqual([]);
    });

    it('answers a blind or malformed address with a fixed sanitized result', async () => {
      const blind = await operator('erase-unclaimed', unique(), '--confirm');
      expect(blind).toEqual({
        status: 'ok',
        applied: true,
        operations: 0,
        recipient_sends: 0,
        throttle_hits: 0
      });
      expect(await operator('erase-unclaimed', 'not-an-address', '--confirm')).toEqual({
        status: 'rejected',
        code: 'EMAIL_INVALID'
      });
    });

    it('is reachable only through the service role', async () => {
      const [player] = kit.players;
      const denied = await player!.client.rpc('privacy_op_erase_unclaimed', {
        p_email: unique(),
        p_confirm: true
      });
      expect(denied.error?.code).toBe('42501');
      const anon = createClient(environment.env!.url, environment.env!.key, {
        auth: { persistSession: false }
      });
      expect(
        (await anon.rpc('privacy_op_erase_unclaimed', { p_email: unique(), p_confirm: true })).error
          ?.code
      ).toBe('42501');
      const rows = await sqlRows(
        "select has_function_privilege('authenticated', 'privacy_internal.erase_unclaimed_identity(text, boolean, boolean)', 'EXECUTE') as a, has_function_privilege('service_role', 'privacy_internal.erase_unclaimed_identity(text, boolean, boolean)', 'EXECUTE') as s"
      );
      expect(rows[0]).toEqual({ a: false, s: false });
    });
  }
);
