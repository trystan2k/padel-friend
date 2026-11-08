import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  executeTrustedSql,
  openDedicatedSqlConnection,
  queryTrustedSql
} from './helpers/sql-transport';

// Global claimant contracts run serially. Every fixture and queue-isolation change rolls back.
describe('transactional Push outbox', () => {
  async function check(body: string, category = 'community') {
    const user = randomUUID();
    const notification = randomUUID();
    const device = randomUUID();
    const result = await executeTrustedSql(`begin;
      update public.notification_push_jobs set next_attempt_at = now() + interval '2 days' where status = 'pending';
      insert into auth.users(id, email) values ('${user}', '${user}@example.test');
      insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth,vapid_key_id,locale,created_at)
        values ('${device}','${user}','https://fcm.googleapis.com/fcm/send/${device}', 'B' || repeat('A',86),repeat('A',22),'key-1','en',now()-interval '1 minute');
      insert into public.notification_preferences(user_id,push_enabled) values ('${user}',true);
      insert into public.notifications(id,recipient_user_id,event_key,kind,category,target_type,target_id)
        values ('${notification}','${user}','test:${notification}','community_invitation','${category}','community_invitation','${notification}');
      do $test$ declare n uuid := '${notification}'; u uuid := '${user}'; s uuid := '${device}'; j public.notification_push_jobs; token uuid; data jsonb; c integer; begin
      ${body}
      end $test$; rollback;`);
    expect(result).toBeUndefined();
  }

  it('enqueues atomically once, materializes once, excludes future enrollment and missing preferences', async () => {
    await expect(
      check(`
      if (select count(*) from public.notification_push_jobs where notification_id=n) <> 1 then raise exception 'missing atomic job'; end if;
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token := j.claim_token;
      if public.notification_push_health()->>'oldestDue' is not null then raise exception 'health counted future work as due'; end if;
      select count(*) into c from public.materialize_notification_push(n,token);
      if c <> 1 then raise exception 'missing device'; end if;
      update public.push_subscriptions set created_at=now()+interval '1 second' where id=s;
      if public.prepare_notification_push(n,s,token) is not null then raise exception 're-enrollment replay'; end if;
      if (select status from public.notification_push_deliveries where notification_id=n) <> 'skipped' then raise exception 'not terminal skipped'; end if;
      if not public.finish_notification_push(n,token) then raise exception 'finish failed'; end if;
      if (select count(*) from public.notifications where id=n) <> 1 then raise exception 'in-app lost'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('fences stale leases, recovers expired leases, never resends successful devices', async () => {
    await expect(
      check(`
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token := j.claim_token;
      perform public.materialize_notification_push(n,token);
      -- Provider accepted this attempt, worker crashed before acknowledgement: same logical delivery retries.
      perform public.prepare_notification_push(n,s,token);
      update public.notification_push_jobs set lease_expires_at=now()-interval '1 second' where notification_id=n;
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n;
      if j.claim_token = token then raise exception 'token reused'; end if;
      if public.settle_notification_push_delivery(n,s,token,'accepted') then raise exception 'stale ack'; end if;
      if public.prepare_notification_push(n,s,j.claim_token) is null then raise exception 'recovery failed'; end if;
      perform public.settle_notification_push_delivery(n,s,j.claim_token,'accepted',201);
      if public.prepare_notification_push(n,s,j.claim_token) is not null then raise exception 'successful device resent'; end if;
      perform public.finish_notification_push(n,j.claim_token);
    `)
    ).resolves.toBeUndefined();
  });

  it('rechecks preferences before retry and retires only expired device without deleting in-app', async () => {
    await expect(
      check(`
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token:=j.claim_token;
      perform public.materialize_notification_push(n,token);
      data:=public.prepare_notification_push(n,s,token);
      perform public.settle_notification_push_delivery(n,s,token,'pending',503,1);
      update public.notification_push_deliveries set next_attempt_at=now() where notification_id=n;
      update public.notification_preferences set push_community=false where user_id=u;
      if public.prepare_notification_push(n,s,token) is not null then raise exception 'preference ignored'; end if;
      update public.notification_push_deliveries set status='pending' where notification_id=n;
      perform public.settle_notification_push_delivery(n,s,token,'expired',410);
      if (select retired_reason from public.push_subscriptions where id=s) <> 'endpoint_gone' then raise exception 'not retired'; end if;
      if not exists(select 1 from public.notifications where id=n and read_at is null) then raise exception 'in-app changed'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('enforces budgets and TTL; unavailable configuration restores attempts', async () => {
    await expect(
      check(`
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token:=j.claim_token;
      perform public.materialize_notification_push(n,token);
      perform public.prepare_notification_push(n,s,token);
      perform public.settle_notification_push_delivery(n,s,token,'unavailable',403);
      perform public.finish_notification_push(n,token,true);
      if (select attempt_count from public.notification_push_jobs where notification_id=n) <> 0 then raise exception 'config burned job'; end if;
      if (select attempt_count from public.notification_push_deliveries where notification_id=n) <> 0 then raise exception 'config burned delivery'; end if;
      update public.notification_push_jobs set created_at=now()-interval '25 hours',next_attempt_at=now() where notification_id=n;
      perform public.claim_notification_push_jobs(25);
      if (select status from public.notification_push_jobs where notification_id=n) <> 'exhausted' then raise exception 'TTL ignored'; end if;
      if (select status from public.notification_push_deliveries where notification_id=n) <> 'exhausted' then raise exception 'delivery TTL ignored'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it.each(['community', 'matches', 'results', 'rankings', 'leagues'])(
    'category %s off suppresses Push without touching in-app',
    async (category) => {
      await expect(
        check(
          `
      update public.notification_preferences set push_${category}=false where user_id=u;
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token:=j.claim_token;
      perform public.materialize_notification_push(n,token);
      if public.prepare_notification_push(n,s,token) is not null then raise exception 'category ignored'; end if;
      if (select status from public.notification_push_deliveries where notification_id=n) <> 'skipped' then raise exception 'not terminal'; end if;
      if not exists(select 1 from public.notifications where id=n) then raise exception 'alert suppressed'; end if;
    `,
          category
        )
      ).resolves.toBeUndefined();
    }
  );

  it('missing/global/category preferences suppress terminally; future enrollment never materializes', async () => {
    await expect(
      check(`
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token:=j.claim_token;
      update public.push_subscriptions set created_at=now()+interval '1 second' where id=s;
      select count(*) into c from public.materialize_notification_push(n,token);
      if c <> 0 then raise exception 'future enrollment materialized'; end if;
      update public.push_subscriptions set created_at=now()-interval '1 minute' where id=s;
      perform public.materialize_notification_push(n,token);
      if exists(select 1 from public.notification_push_deliveries where notification_id=n) then raise exception 'fanout materialized twice'; end if;
      insert into public.notification_push_deliveries(notification_id,subscription_id,enrollment_created_at) select n,s,created_at from public.push_subscriptions where id=s;
      delete from public.notification_preferences where user_id=u;
      if public.prepare_notification_push(n,s,token) is not null then raise exception 'missing prefs enabled'; end if;
      if (select attempt_count from public.notification_push_deliveries where notification_id=n) <> 0 then raise exception 'skipped burned attempt'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('partial multi-device success survives lost ack, attempt exhaustion, and per-key emergency retirement', async () => {
    await expect(
      check(`
      insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,vapid_key_id,locale,created_at)
        select user_id,endpoint||'-second',p256dh,auth,'key-2',locale,created_at from public.push_subscriptions where id=s;
      select * into j from public.claim_notification_push_jobs(25) where notification_id=n; token:=j.claim_token;
      select count(*) into c from public.materialize_notification_push(n,token);
      if c <> 2 then raise exception 'missing second device'; end if;
      perform public.prepare_notification_push(n,s,token);
      perform public.settle_notification_push_delivery(n,s,token,'accepted',201);
      update public.notification_push_deliveries set attempt_count=5 where notification_id=n and subscription_id<>s;
      select subscription_id into s from public.notification_push_deliveries where notification_id=n and subscription_id<>s;
      perform public.prepare_notification_push(n,s,token);
      perform public.settle_notification_push_delivery(n,s,token,'pending',503);
      if (select count(*) from public.notification_push_deliveries where notification_id=n and status='accepted') <> 1 then raise exception 'successful device lost'; end if;
      if (select status from public.notification_push_deliveries where notification_id=n and subscription_id=s) <> 'exhausted' then raise exception 'budget ignored'; end if;
      perform public.finish_notification_push(n,token);
      perform public.revoke_notification_push_keys(array['key-2']);
      if (select count(*) from public.push_subscriptions where user_id=u and retired_at is null) <> 1 then raise exception 'mass key retirement'; end if;
      if not exists(select 1 from public.notifications where id=n) then raise exception 'alert lost'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('notification failure rolls back its job in the same subtransaction; deduped persist creates no second job', async () => {
    await expect(
      check(`
      begin
        insert into public.notifications(recipient_user_id,event_key,kind,category,target_type,target_id)
          values (u,'rollback-test','community_invitation','community','community_invitation',n);
        raise exception 'ROLLBACK_FIXTURE';
      exception when raise_exception then null; end;
      if exists(select 1 from public.notifications where event_key='rollback-test' and recipient_user_id=u) then raise exception 'rollback leaked notification'; end if;
      if exists(select 1 from public.notification_push_jobs j2 left join public.notifications n2 on n2.id=j2.notification_id where n2.id is null) then raise exception 'rollback leaked job'; end if;
      perform public.persist_notification(u,'test:'||n::text,'community_invitation','community','community_invitation',n,null);
      if (select count(*) from public.notification_push_jobs where notification_id=n) <> 1 then raise exception 'replay duplicated job'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('anonymous recipients never gain authoritative alerts or Push jobs from a producer', async () => {
    await expect(
      check(`
      update auth.users set is_anonymous=true where id=u;
      if public.persist_notification(u,'anonymous:'||n::text,'community_invitation','community','community_invitation',n,null) is not null then raise exception 'anonymous alert created'; end if;
      if exists(select 1 from public.notifications where recipient_user_id=u and event_key='anonymous:'||n::text) then raise exception 'anonymous recipient leaked'; end if;
      if (select count(*) from public.notification_push_jobs where notification_id in(select id from public.notifications where recipient_user_id=u)) <> 1 then raise exception 'anonymous job created'; end if;
    `)
    ).resolves.toBeUndefined();
  });

  it('overlapping claimants skip locked jobs rather than duplicate or block', async () => {
    const user = randomUUID();
    const id = randomUUID();
    const held = (
      await queryTrustedSql(
        `with held as materialized(select notification_id,next_attempt_at from public.notification_push_jobs where status='pending' for update) update public.notification_push_jobs j set next_attempt_at=now()+interval '2 days' from held h where h.notification_id=j.notification_id returning h.*`
      )
    ).rows;
    const first = await openDedicatedSqlConnection();
    const second = await openDedicatedSqlConnection();
    try {
      await executeTrustedSql(
        `insert into auth.users(id,email) values('${user}','${user}@example.test'); insert into public.notifications(id,recipient_user_id,event_key,kind,category,target_type,target_id) values('${id}','${user}','race:${id}','community_invitation','community','community_invitation','${id}')`
      );
      await first.query('begin');
      await second.query('begin');
      const a = await first.query(
        'select notification_id::text,claim_token::text from public.claim_notification_push_jobs(25)'
      );
      expect(a.rows.map((row) => row.notification_id)).toEqual([id]);
      const b = await second.query(
        'select notification_id from public.claim_notification_push_jobs(25)'
      );
      expect(b.rows).toEqual([]);
    } finally {
      await first.query('rollback');
      await second.query('rollback');
      await first.close();
      await second.close();
      await executeTrustedSql(`delete from auth.users where id='${user}'`);
      await queryTrustedSql(
        `update public.notification_push_jobs j set next_attempt_at=h.next_attempt_at from jsonb_to_recordset($1::jsonb) as h(notification_id uuid,next_attempt_at timestamptz) where j.notification_id=h.notification_id and j.status='pending'`,
        { values: [JSON.stringify(held)] }
      );
    }
  });

  it('denies anon and authenticated access to every service RPC and private table', async () => {
    const result = await executeTrustedSql(`do $$ declare r text; f regprocedure; begin
      foreach r in array array['anon','authenticated'] loop
        for f in select oid::regprocedure from pg_proc where proname in ('claim_notification_push_jobs','materialize_notification_push','prepare_notification_push','settle_notification_push_delivery','finish_notification_push','revoke_notification_push_keys','notification_push_health') loop
          if has_function_privilege(r,f,'EXECUTE') then raise exception 'public service RPC: % %',r,f; end if;
        end loop;
        if has_table_privilege(r,'public.notification_push_jobs','SELECT') or has_table_privilege(r,'public.notification_push_deliveries','INSERT') then raise exception 'public outbox'; end if;
      end loop; end $$;`);
    expect(result).toBeUndefined();
  });
});
