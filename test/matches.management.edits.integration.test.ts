import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import {
  fixtureSql,
  sqlRows,
  proveEventLockBarrier,
  asRecord
} from './helpers/match-registration-sql';

describe('minor match edits integration', () => {
  let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchManagementFixtures(env);
  });
  afterAll(async () => {
    if (f) await f.cleanup();
  });
  const command = (
    id: string,
    patch: Record<string, unknown>,
    version = 1,
    request = crypto.randomUUID()
  ) => ({
    p_match_event_id: id,
    p_expected_version: version,
    p_patch: patch,
    p_request_id: request
  });
  async function snapshot(id: string) {
    return sqlRows(`select to_jsonb(e) as event,to_jsonb(s) as state,
      (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.match_event_registrations r where match_event_id=e.id) as registrations,
      (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.match_event_audit_log a where match_event_id=e.id) as audit,
      (select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.notifications n where target_id=e.id) as notifications,
      (select coalesce(jsonb_agg(to_jsonb(c) order by request_id),'[]') from public.match_event_management_commands c where match_event_id=e.id) as commands
      from public.match_events e join public.match_event_registration_state s on s.match_event_id=e.id where e.id='${id}'`);
  }
  it('creator edits all minor keys and other roles cannot', async () => {
    const player = await f.member();
    const outsider = await f.actor();
    const admin = await f.member();
    await fixtureSql(
      `do $$ begin alter table public.community_members disable trigger community_member_guard;update public.community_members set role='admin' where community_id='${f.communityId}' and user_id='${admin.id}';alter table public.community_members enable trigger community_member_guard;end $$;`
    );
    const e = await f.event({ accepted: [player] });
    const patch = {
      venue_name: 'New court',
      maps_url: 'https://maps.app.goo.gl/new',
      court_notes: 'Court two',
      price_minor: 2250,
      currency: 'EUR',
      payment_note: 'Pay on arrival',
      notes: 'Bring water',
      maximum_registrations: 8,
      registration_cutoff_at: new Date(Date.now() + 86400000).toISOString()
    };
    const before = await snapshot(e.id);
    for (const actor of [player, outsider, admin])
      expect((await f.rpc(actor, 'edit_match_event', command(e.id, patch))).error?.code).toBe(
        '42501'
      );
    expect(await snapshot(e.id)).toEqual(before);
    const result = await f.rpc(f.creator, 'edit_match_event', command(e.id, patch));
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      version: 2,
      changed: true,
      change_kind: 'minor',
      reconfirmation_generation: 0,
      changed_fields: Object.keys(patch).sort()
    });
    expect(
      (await f.rpc(f.creator, 'get_match_event_management', { p_match_event_id: e.id })).data
    ).toMatchObject({ version: 2, actions: { edit: { allowed: true, reason: null } } });
    expect(
      await sqlRows(
        `select venue_name,maps_url,court_notes,price_minor,currency,payment_note,notes,maximum_registrations from public.match_events where id='${e.id}'`
      )
    ).toEqual([
      {
        venue_name: patch.venue_name,
        maps_url: patch.maps_url,
        court_notes: patch.court_notes,
        price_minor: 2250,
        currency: 'EUR',
        payment_note: patch.payment_note,
        notes: patch.notes,
        maximum_registrations: 8
      }
    ]);
    expect(
      await sqlRows(
        `select has_function_privilege('anon','public.edit_match_event(uuid,bigint,jsonb,uuid)','EXECUTE') as anon,has_table_privilege('authenticated','public.match_events','UPDATE') as raw`
      )
    ).toEqual([{ anon: false, raw: false }]);
  });
  it('same expected version concurrent edits have one winner and no partial write', async () => {
    const e = await f.event();
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'edit_match_event',
      fire: () => [
        f.rpc(f.creator, 'edit_match_event', command(e.id, { venue_name: 'Winner A', notes: 'A' })),
        f.rpc(f.creator, 'edit_match_event', command(e.id, { venue_name: 'Winner B', notes: 'B' }))
      ]
    });
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe('MATCH_MANAGEMENT_VERSION_CONFLICT');
    const rows = await sqlRows(
      `select venue_name,notes,version,(select count(*) from public.match_event_audit_log where match_event_id=e.id) as audits from public.match_events e where id='${e.id}'`
    );
    expect(rows[0]).toMatchObject({ version: 2, audits: 1 });
    expect(rows[0]?.venue_name).toBe(`Winner ${String(rows[0]?.notes)}`);
  });
  it('stale version leaves facts audit revision and notifications unchanged', async () => {
    const e = await f.event();
    await f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'First' }));
    const before = await snapshot(e.id);
    const result = await f.creator.client.rpc('edit_match_event', {
      ...command(e.id, {}),
      p_patch: { venue_name: 'Stale' }
    });
    expect(result.error?.message).toBe('MATCH_MANAGEMENT_VERSION_CONFLICT');
    expect(JSON.parse(result.error?.details ?? '{}')).toEqual({ current_version: 2 });
    expect(await snapshot(e.id)).toEqual(before);
  });
  it('venue price and notes notify and audit without consent change', async () => {
    const accepted = await f.member();
    const pending = await f.actor();
    const invited = await f.member();
    const e = await f.event({ accepted: [accepted], invites: [invited, pending, accepted] });
    expect(
      (await f.rpc(pending, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    const registrations = await sqlRows(
      `select to_jsonb(r) as r from public.match_event_registrations r where match_event_id='${e.id}' order by id`
    );
    const state = await sqlRows(
      `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
    );
    const request = crypto.randomUUID();
    const input = command(
      e.id,
      { venue_name: 'New court', price_minor: 1234, currency: 'USD', notes: 'New notes' },
      1,
      request
    );
    const result = await f.rpc(f.creator, 'edit_match_event', input);
    expect(result.error).toBeNull();
    expect(
      await sqlRows(
        `select to_jsonb(r) as r from public.match_event_registrations r where match_event_id='${e.id}' order by id`
      )
    ).toEqual(registrations);
    expect(
      await sqlRows(
        `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
      )
    ).toEqual([{ transition_revision: Number(state[0]?.transition_revision) + 1 }]);
    const recipients = [f.creator.id, accepted.id, pending.id, invited.id].sort();
    const notices = await sqlRows(
      `select id,recipient_user_id,event_key from public.notifications where target_id='${e.id}' and kind='match_event_updated' order by recipient_user_id`
    );
    expect(notices.map((n) => n.recipient_user_id)).toEqual(recipients);
    expect(notices.every((n) => n.event_key === `match.updated:${e.id}:2`)).toBe(true);
    for (const actor of [f.creator, accepted, pending, invited]) {
      const notice = notices.find((n) => n.recipient_user_id === actor.id)!;
      expect(
        (await f.rpc(actor, 'get_my_notification_target_v2', { p_notification_id: notice.id })).data
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ target_status: 'match_available', match_event_id: e.id })
        ])
      );
      expect(
        (
          await f.rpc(actor, 'get_my_match_notification_contexts', {
            p_notification_ids: [notice.id]
          })
        ).data
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            match_event_id: e.id,
            venue: 'New court',
            price_minor: 1234,
            currency: 'USD'
          })
        ])
      );
    }
    expect(
      await sqlRows(
        `select action,before_data,after_data,changed_fields from public.match_event_audit_log where match_event_id='${e.id}'`
      )
    ).toEqual([
      {
        action: 'minor_edit',
        before_data: {
          venue_name: 'Invitation court',
          price_minor: null,
          currency: null,
          notes: null
        },
        after_data: {
          venue_name: 'New court',
          price_minor: 1234,
          currency: 'USD',
          notes: 'New notes'
        },
        changed_fields: ['currency', 'notes', 'price_minor', 'venue_name']
      }
    ]);
    const before = await snapshot(e.id);
    expect((await f.rpc(f.creator, 'edit_match_event', input)).data).toMatchObject({
      version: 2,
      replayed: true
    });
    expect(await snapshot(e.id)).toEqual(before);
    expect(
      (await f.rpc(f.creator, 'edit_match_event', { ...input, p_patch: { notes: 'Different' } }))
        .error?.message
    ).toBe('MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT');
    expect(await snapshot(e.id)).toEqual(before);
  });
  it('cutoff move changes pending invitation expiry without reopening processed cutoff', async () => {
    const invitee = await f.member();
    const e = await f.event({ invites: [invitee] });
    const cutoff = new Date(Date.now() + 86400000).toISOString();
    expect(
      (
        await f.rpc(
          f.creator,
          'edit_match_event',
          command(e.id, { registration_cutoff_at: cutoff })
        )
      ).error
    ).toBeNull();
    const invite = await f.rpc(invitee, 'get_my_match_invitation', { p_match_event_id: e.id });
    expect(invite.data).toMatchObject({ effective_status: 'pending' });
    expect(Date.parse(String(asRecord(invite.data).expires_at))).toBe(Date.parse(cutoff));
    await fixtureSql(
      `update public.match_event_registration_state set cutoff_processed_at=clock_timestamp() where match_event_id='${e.id}'`
    );
    const before = await snapshot(e.id);
    expect(
      (
        await f.rpc(
          f.creator,
          'edit_match_event',
          command(
            e.id,
            { registration_cutoff_at: new Date(Date.now() + 172800000).toISOString() },
            2
          )
        )
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_CLOSED');
    expect(await snapshot(e.id)).toEqual(before);
  });
  it('negative price unsupported currency cutoff at start and capacity below accepted reject atomically', async () => {
    const player = await f.member();
    const e = await f.event({ accepted: [player] });
    const start = (await sqlRows(`select starts_at from public.match_events where id='${e.id}'`))[0]
      ?.starts_at;
    const before = await snapshot(e.id);
    for (const patch of [
      { price_minor: -1, currency: 'EUR' },
      { price_minor: 5, currency: 'GBP' },
      { registration_cutoff_at: start },
      { maximum_registrations: 1 },
      { price_minor: 5 },
      { currency: 'USD' },
      { price_minor: null, currency: 'USD' },
      { venue_name: null },
      { notes: { nested: 'bad' } },
      { event_type: 'competitive' },
      { starts_at: '2099-01-01T00:00:00Z' },
      { price_minor: 9007199254740992, currency: 'EUR' },
      { maximum_registrations: 2147483648 },
      { registration_cutoff_at: '2028-02-30T12:00:00Z' },
      { registration_cutoff_at: '2099-01-01' },
      { maps_url: 'https://evil.test/maps/x' },
      { notes: 'x'.repeat(2001) }
    ]) {
      expect(
        (await f.rpc(f.creator, 'edit_match_event', command(e.id, patch))).error
      ).not.toBeNull();
      expect(await snapshot(e.id)).toEqual(before);
    }
    expect(
      (
        await f.rpc(
          f.creator,
          'edit_match_event',
          command(e.id, { maximum_registrations: null, price_minor: 0, currency: 'BRL' })
        )
      ).error
    ).toBeNull();
    expect(
      (
        await f.rpc(
          f.creator,
          'edit_match_event',
          command(e.id, { price_minor: null, currency: null }, 2)
        )
      ).error
    ).toBeNull();
  }, 30000);
  it('edit after cutoff start cancellation or protected result fails', async () => {
    for (const [mode, message] of [
      ['cutoff', 'CLOSED'],
      ['start', 'STARTED'],
      ['cancel', 'CANCELLED'],
      ['protected', 'RESULT_PROTECTED']
    ] as const) {
      const e = await f.event();
      if (mode === 'cutoff') await f.setCutoff(e.id, "clock_timestamp()-interval '1 minute'");
      if (mode === 'start')
        await fixtureSql(
          `do $$ begin alter table public.match_events disable trigger match_event_immutable;update public.match_events set starts_at=clock_timestamp()-interval '1 minute',registration_cutoff_at=clock_timestamp()-interval '2 minutes' where id='${e.id}';alter table public.match_events enable trigger match_event_immutable;end $$;`
        );
      if (mode === 'cancel')
        await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: e.id,
          p_reason: 'Weather',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        });
      if (mode === 'protected')
        await fixtureSql(`select public.protect_match_event_results('${e.id}')`);
      const before = await snapshot(e.id);
      expect(
        (await f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'Unavailable' }))).error
          ?.message
      ).toBe(`MATCH_MANAGEMENT_${message}`);
      expect(await snapshot(e.id)).toEqual(before);
    }
  });
  it('equivalent patch produces no version bump or effects', async () => {
    const e = await f.event();
    const before = await snapshot(e.id);
    for (const patch of [{}, { venue_name: 'Invitation court', notes: null }])
      expect((await f.rpc(f.creator, 'edit_match_event', command(e.id, patch))).data).toMatchObject(
        { changed: false, version: 1, changed_fields: [], change_kind: 'none' }
      );
    const withoutCommands = (rows: Awaited<ReturnType<typeof snapshot>>) =>
      rows.map((row) => ({
        event: row.event,
        state: row.state,
        registrations: row.registrations,
        audit: row.audit,
        notifications: row.notifications
      }));
    const after = await snapshot(e.id);
    expect(withoutCommands(after)).toEqual(withoutCommands(before));
  });
  it('clears stale saved venue association in audit but preserves attached photo', async () => {
    const e = await f.event();
    const venue = crypto.randomUUID();
    await fixtureSql(
      `do $$ begin insert into public.community_venues(id,community_id,name,maps_url,created_by) values('${venue}','${f.communityId}','Invitation court','https://maps.google.com/maps/place/invitation','${f.creator.id}');alter table public.match_events disable trigger match_event_immutable;update public.match_events set saved_venue_id='${venue}' where id='${e.id}';alter table public.match_events enable trigger match_event_immutable;end $$;`
    );
    try {
      const photo = await sqlRows(`select photo_path from public.match_events where id='${e.id}'`);
      expect(
        (
          await f.rpc(
            f.creator,
            'edit_match_event',
            command(e.id, { venue_name: 'Different venue' })
          )
        ).data
      ).toMatchObject({ changed_fields: ['saved_venue_id', 'venue_name'] });
      expect(
        await sqlRows(
          `select saved_venue_id,photo_path from public.match_events where id='${e.id}'`
        )
      ).toEqual([{ saved_venue_id: null, photo_path: photo[0]?.photo_path }]);
      expect(
        await sqlRows(
          `select before_data->>'saved_venue_id' as before,after_data->'saved_venue_id' as after from public.match_event_audit_log where match_event_id='${e.id}'`
        )
      ).toEqual([{ before: venue, after: null }]);
    } finally {
      await fixtureSql(`delete from public.community_venues where id='${venue}'`);
    }
  });
  it('notification failure rolls back facts revision audit and command', async () => {
    const e = await f.event();
    await fixtureSql(
      `insert into public.notifications(recipient_user_id,event_key,kind,category,target_type,target_id,community_id) values('${f.creator.id}','match.updated:${e.id}:2','match_event_cancelled','matches','match_event','${e.id}','${f.communityId}')`
    );
    const before = await snapshot(e.id);
    expect(
      (await f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'Must rollback' }))).error
    ).not.toBeNull();
    expect(await snapshot(e.id)).toEqual(before);
  });
  it('a lock wait across the old cutoff rejects both edits without side effects', async () => {
    const e = await f.event({ cutoff: "clock_timestamp()+interval '5 seconds'" });
    const before = await snapshot(e.id);
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'edit_match_event',
      releaseAtCutoff: true,
      fire: () => [
        f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'Late A' })),
        f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'Late B' }))
      ]
    });
    expect(results.map((result) => result.error?.message)).toEqual([
      'MATCH_MANAGEMENT_CLOSED',
      'MATCH_MANAGEMENT_CLOSED'
    ]);
    expect(await snapshot(e.id)).toEqual(before);
  }, 20000);
  it('former organizer loses edit authority even when still community admin', async () => {
    const next = await f.member();
    const e = await f.event({ accepted: [next] });
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: next.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    const before = await snapshot(e.id);
    expect(
      (await f.rpc(f.creator, 'edit_match_event', command(e.id, { notes: 'Former organizer' }, 2)))
        .error?.code
    ).toBe('42501');
    expect(await snapshot(e.id)).toEqual(before);
    expect(
      (await f.rpc(next, 'edit_match_event', command(e.id, { notes: 'Current organizer' }, 2)))
        .error
    ).toBeNull();
  });
});
