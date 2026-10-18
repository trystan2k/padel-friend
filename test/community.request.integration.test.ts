import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
const password = 'Password123!';

describe.skipIf(!environment.env)('community request delivery (real local Supabase JWTs)', () => {
  function env(): Env {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }
  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const signup = await anonymous.auth.signUp({
      email: `${slug}-${crypto.randomUUID()}@example.test`,
      password
    });
    expect(signup.error, 'local email confirmation must be disabled').toBeNull();
    const token = signup.data.session?.access_token;
    expect(token).toBeTruthy();
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const onboard = await client.rpc('onboard_player', {
      p_display_name: label,
      p_preferred_side: 'EITHER',
      p_initial_level: 3.2
    });
    expect(onboard.error).toBeNull();
    return { client, id: signup.data.user!.id };
  }
  async function fixture() {
    const admin = await actor('Message Admin');
    const applicant = await actor('Message Applicant');
    const outsider = await actor('Message Outsider');
    const created = await admin.client.rpc('create_community', {
      p_name: `Message ${crypto.randomUUID().slice(0, 8)}`,
      p_visibility: 'public',
      p_join_policy: 'admin_approval'
    });
    expect(created.error).toBeNull();
    if (typeof created.data !== 'string') throw new Error('Community RPC returned no id');
    const communityId = created.data;
    const joined = await applicant.client.rpc('join_public_community', {
      p_community_id: communityId
    });
    expect(joined.error).toBeNull();
    expect(
      (await outsider.client.rpc('join_public_community', { p_community_id: communityId })).error
    ).toBeNull();
    const requests = await admin.client.rpc('search_community_members', {
      p_community_id: communityId,
      p_query: '',
      p_status: 'pending',
      p_offset: 0,
      p_limit: 50
    });
    expect(requests.error).toBeNull();
    const membershipId = requests.data!.find(
      (row: { user_id: string }) => row.user_id === applicant.id
    )!.membership_id;
    const observerId = requests.data!.find(
      (row: { user_id: string }) => row.user_id === outsider.id
    )!.membership_id;
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: observerId,
          p_action: 'approve'
        })
      ).error
    ).toBeNull();
    return { admin, applicant, outsider, communityId, membershipId };
  }
  const send = (
    client: SupabaseClient,
    communityId: string,
    membershipId: string,
    body: string,
    requestId = crypto.randomUUID()
  ) =>
    client.rpc('send_community_request_message', {
      p_community_id: communityId,
      p_membership_id: membershipId,
      p_body: body,
      p_client_request_id: requestId
    });

  it('enforces recipient/admin RLS, pending ownership, retries, writes and read idempotency', async () => {
    const { admin, applicant, outsider, communityId, membershipId } = await fixture();
    const token = crypto.randomUUID();
    const first = await send(
      admin.client,
      communityId,
      membershipId,
      '<img src=x onerror=alert(1)>',
      token
    );
    expect(first.error).toBeNull();
    const messageId = first.data![0]!.message_id;
    const retry = await send(
      admin.client,
      communityId,
      membershipId,
      '<img src=x onerror=alert(1)>',
      token
    );
    expect(retry.data).toEqual(first.data);
    expect(
      (await send(admin.client, communityId, membershipId, 'Different body', token)).error
    ).not.toBeNull();
    const otherCommunity = await admin.client.rpc('create_community', {
      p_name: `Other ${crypto.randomUUID().slice(0, 8)}`,
      p_visibility: 'public',
      p_join_policy: 'admin_approval'
    });
    expect(otherCommunity.error).toBeNull();
    expect(
      (await send(admin.client, otherCommunity.data, membershipId, 'cross-community membership'))
        .error
    ).not.toBeNull();
    const received = await applicant.client
      .from('community_request_messages')
      .select('id,body,community_id,membership_id')
      .eq('id', messageId);
    expect(received.data).toEqual([
      {
        id: messageId,
        body: '<img src=x onerror=alert(1)>',
        community_id: communityId,
        membership_id: membershipId
      }
    ]);
    expect(
      (await outsider.client.from('community_request_messages').select('body').eq('id', messageId))
        .data
    ).toEqual([]);
    expect(
      (await admin.client.from('community_request_messages').select('body').eq('id', messageId))
        .data
    ).toHaveLength(1);
    expect(
      (
        await applicant.client
          .from('community_notifications')
          .select('id,request_message_id,kind,created_at,read_at')
      ).data
    ).toHaveLength(1);
    const notification = (
      await applicant.client.from('community_notifications').select('id').single()
    ).data;
    expect(notification).toBeTruthy();
    expect(
      (
        await applicant.client.rpc('get_my_community_notification_timezone', {
          p_notification_id: notification!.id
        })
      ).data
    ).toBe('Europe/Madrid');
    expect(
      (
        await admin.client.rpc('update_community_admin_defaults', {
          p_community_id: communityId,
          p_defaults: {
            timezone: 'UTC',
            currency: 'EUR',
            member_created_leagues_enabled: true
          }
        })
      ).error
    ).toBeNull();
    expect(
      (
        await applicant.client.rpc('get_my_community_notification_timezone', {
          p_notification_id: notification!.id
        })
      ).data
    ).toBe('UTC');
    expect(
      (
        await outsider.client.rpc('get_my_community_notification_timezone', {
          p_notification_id: notification!.id
        })
      ).data
    ).toBeNull();
    expect(
      (await applicant.client.from('communities').select('settings').eq('id', communityId)).error
    ).not.toBeNull();
    const mark = () =>
      applicant.client.rpc('mark_community_notification_read', {
        p_notification_id: notification!.id
      });
    const read = await mark();
    expect(read.error).toBeNull();
    expect((await mark()).data).toEqual(read.data);
    expect(
      (
        await outsider.client.rpc('mark_community_notification_read', {
          p_notification_id: notification!.id
        })
      ).error
    ).not.toBeNull();
    const forged = {
      recipient_user_id: outsider.id,
      request_message_id: messageId,
      kind: 'request_message'
    };
    expect(
      (await admin.client.from('community_notifications').insert(forged)).error
    ).not.toBeNull();
    expect(
      (await admin.client.from('community_notifications').delete().eq('id', notification!.id)).error
    ).not.toBeNull();
    expect(
      (
        await admin.client
          .from('community_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notification!.id)
      ).error
    ).not.toBeNull();
    expect(
      (
        await admin.client.from('community_request_messages').insert({
          community_id: communityId,
          membership_id: membershipId,
          sender_user_id: admin.id,
          recipient_user_id: outsider.id,
          body: 'forged',
          client_request_id: crypto.randomUUID()
        })
      ).error
    ).not.toBeNull();
    expect(
      (await admin.client.from('community_request_messages').delete().eq('id', messageId)).error
    ).not.toBeNull();
    expect(
      (
        await admin.client
          .from('community_request_messages')
          .update({ body: 'changed' })
          .eq('id', messageId)
      ).error
    ).not.toBeNull();
    expect(
      (await send(applicant.client, communityId, membershipId, 'forged sender')).error
    ).not.toBeNull();
    expect(
      (await send(admin.client, communityId, crypto.randomUUID(), 'forged membership')).error
    ).not.toBeNull();
    expect(
      (await send(admin.client, communityId, membershipId, 'x'.repeat(1001))).error
    ).not.toBeNull();
    expect((await send(admin.client, communityId, membershipId, '   ')).error).not.toBeNull();
  });

  it('rejects anonymous database access and preserves plain-text message delivery after recipient closure', async () => {
    const { applicant, admin, communityId, membershipId } = await fixture();
    const anonymous = createClient(env().url, env().key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    expect(
      (
        await anonymous.rpc('send_community_request_message', {
          p_community_id: communityId,
          p_membership_id: membershipId,
          p_body: 'anonymous',
          p_client_request_id: crypto.randomUUID()
        })
      ).error
    ).not.toBeNull();
    const anonymousSession = await anonymous.auth.signInAnonymously();
    const anonymousResult = anonymousSession.data.session
      ? (
          await anonymous.rpc('send_community_request_message', {
            p_community_id: communityId,
            p_membership_id: membershipId,
            p_body: 'anonymous user',
            p_client_request_id: crypto.randomUUID()
          })
        ).error
      : anonymousSession.error;
    expect(anonymousResult).not.toBeNull();
    const anonRead = await anonymous.from('community_request_messages').select('body');
    expect(anonRead.error).not.toBeNull();
    const requestId = crypto.randomUUID();
    const sent = await send(admin.client, communityId, membershipId, 'Hello applicant', requestId);
    expect(sent.error).toBeNull();
    const closed = await admin.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: membershipId,
      p_action: 'deny'
    });
    expect(closed.error).toBeNull();
    expect(
      (
        await applicant.client
          .from('community_request_messages')
          .select('body')
          .eq('id', sent.data![0]!.message_id)
      ).data
    ).toEqual([{ body: 'Hello applicant' }]);
    expect(
      (await send(admin.client, communityId, membershipId, 'Hello applicant', requestId)).data
    ).toEqual(sent.data);
    expect((await send(admin.client, communityId, membershipId, 'Too late')).error).not.toBeNull();
  });

  it('orders and bounds recipient inbox DTO queries without private community joins', async () => {
    const { admin, applicant, communityId, membershipId } = await fixture();
    for (const body of ['first', 'second', 'third'])
      expect((await send(admin.client, communityId, membershipId, body)).error).toBeNull();
    const rows = await applicant.client
      .from('community_notifications')
      .select(
        'id,created_at,read_at,request_message_id,community_request_messages!inner(id,body,created_at)'
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 1);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
    expect(Object.keys(rows.data![0]!).sort()).toEqual(
      ['community_request_messages', 'created_at', 'id', 'read_at', 'request_message_id'].sort()
    );
    expect(JSON.stringify(rows.data)).not.toContain('visibility');
    expect(JSON.stringify(rows.data)).not.toContain('settings');
    expect(
      (await applicant.client.from('community_notifications').select('*').range(0, 50)).error
    ).toBeNull();
  });

  it('returns batch timezones only for notifications received by the caller', async () => {
    const { admin, applicant, outsider, communityId, membershipId } = await fixture();
    expect(
      (await send(admin.client, communityId, membershipId, 'Timezone lookup')).error
    ).toBeNull();
    const notification = (
      await applicant.client.from('community_notifications').select('id').single()
    ).data;
    expect(notification).toBeTruthy();

    const received = await applicant.client.rpc('get_my_community_notification_timezones', {
      p_notification_ids: [notification!.id]
    });
    expect(received.error).toBeNull();
    expect(received.data).toEqual([
      { notification_id: notification!.id, time_zone: 'Europe/Madrid' }
    ]);

    const unauthorized = await outsider.client.rpc('get_my_community_notification_timezones', {
      p_notification_ids: [notification!.id]
    });
    expect(unauthorized.error).toBeNull();
    expect(unauthorized.data).toEqual([]);
  });

  // Spawns the Supabase CLI twice (batched setup/teardown SQL); each CLI boot is
  // a real process spawn plus a local-DB round trip, which alone can exceed 1s
  // on slow CI runners, so this test carries an explicit timeout.
  it('rolls back the message insert when notification creation fails', async () => {
    // The blocker is scoped to THIS fixture's applicant (vitest runs suites
    // in parallel against one shared local database, so an unscoped trigger
    // on community_notifications would poison concurrent community suites).
    const { admin, applicant, communityId, membershipId } = await fixture();
    const sql = (statement: string) =>
      execFileSync('pnpm', ['exec', 'supabase', 'db', 'query', '--local', statement], {
        encoding: 'utf8'
      });
    sql(
      "do $outer$ begin execute 'create or replace function public.test_reject_community_notification() returns trigger language plpgsql as $$ begin raise exception ''injected notification failure''; end $$'; " +
        `execute 'create trigger test_reject_community_notification before insert on public.community_notifications for each row when (new.recipient_user_id = ''${applicant.id}'') execute function public.test_reject_community_notification()'; end $outer$;`
    );
    try {
      const requestId = crypto.randomUUID();
      expect(
        (await send(admin.client, communityId, membershipId, 'transaction rollback', requestId))
          .error
      ).not.toBeNull();
      const rows = await admin.client
        .from('community_request_messages')
        .select('id')
        .eq('community_id', communityId)
        .eq('membership_id', membershipId);
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual([]);
    } finally {
      sql(
        "do $outer$ begin execute 'drop trigger if exists test_reject_community_notification on public.community_notifications'; " +
          "execute 'drop function if exists public.test_reject_community_notification()'; end $outer$;"
      );
    }
    // Loud residue check: the blocker is unscoped (any community_notifications
    // insert raises), so a leftover would poison every later community suite
    // in the shared local database. The cleanup must be provably complete.
    sql(
      'do $outer$ begin ' +
        "if exists (select 1 from pg_catalog.pg_trigger where tgname = 'test_reject_community_notification' and not tgisinternal) " +
        'or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace ' +
        "where n.nspname = 'public' and p.proname = 'test_reject_community_notification') then " +
        "raise exception 'test_reject_community_notification leaked into the shared local database'; " +
        'end if; end $outer$;'
    );
  }, 15000);

  it('rejects all terminal governance outcomes before sending', async () => {
    const { admin, communityId, membershipId } = await fixture();
    const outcome = await admin.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: membershipId,
      p_action: 'approve'
    });
    expect(outcome.error).toBeNull();
    expect(
      (await send(admin.client, communityId, membershipId, 'approved is closed')).error
    ).not.toBeNull();
    const deniedApplicant = await actor('Denied Applicant');
    await deniedApplicant.client.rpc('join_public_community', { p_community_id: communityId });
    const denied = await admin.client.rpc('search_community_members', {
      p_community_id: communityId,
      p_query: '',
      p_status: 'pending',
      p_offset: 0,
      p_limit: 50
    });
    const deniedMember = denied.data!.find(
      (row: { user_id: string }) => row.user_id === deniedApplicant.id
    )!;
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: deniedMember.membership_id,
          p_action: 'deny'
        })
      ).error
    ).toBeNull();
    expect(
      (await send(admin.client, communityId, deniedMember.membership_id, 'denied is closed')).error
    ).not.toBeNull();
    const removedApplicant = await actor('Removed Applicant');
    await removedApplicant.client.rpc('join_public_community', { p_community_id: communityId });
    const morePending = await admin.client.rpc('search_community_members', {
      p_community_id: communityId,
      p_query: '',
      p_status: 'pending',
      p_offset: 0,
      p_limit: 50
    });
    const removedMember = morePending.data!.find(
      (row: { user_id: string }) => row.user_id === removedApplicant.id
    )!;
    await admin.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: removedMember.membership_id,
      p_action: 'approve'
    });
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: removedMember.membership_id,
          p_action: 'remove'
        })
      ).error
    ).toBeNull();
    expect(
      (await send(admin.client, communityId, removedMember.membership_id, 'removed is closed'))
        .error
    ).not.toBeNull();
  });

  it('removes former Admin read access while retaining recipient delivery', async () => {
    const { admin, applicant, outsider, communityId, membershipId } = await fixture();
    const sent = await send(
      admin.client,
      communityId,
      membershipId,
      'still delivered to applicant'
    );
    expect(sent.error).toBeNull();
    const adminMembership = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', communityId)
      .eq('user_id', admin.id)
      .single();
    const observerMembership = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', communityId)
      .eq('user_id', outsider.id)
      .single();
    expect(adminMembership.error).toBeNull();
    expect(observerMembership.error).toBeNull();
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: observerMembership.data!.id,
          p_action: 'promote'
        })
      ).error
    ).toBeNull();
    expect(
      (
        await outsider.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: adminMembership.data!.id,
          p_action: 'demote'
        })
      ).error
    ).toBeNull();
    expect(
      (
        await admin.client
          .from('community_request_messages')
          .select('id')
          .eq('id', sent.data![0]!.message_id)
      ).data
    ).toEqual([]);
    expect(
      (
        await applicant.client
          .from('community_request_messages')
          .select('body')
          .eq('id', sent.data![0]!.message_id)
      ).data
    ).toEqual([{ body: 'still delivered to applicant' }]);
  });
});
