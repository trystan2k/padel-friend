import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { decodeNotificationTarget } from '../src/features/notifications/notification-target';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { MANAGEMENT_NOTIFICATION_COPY } from './helpers/match-management-contract';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement('a', { href: to }, children)
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationTarget: vi.fn<() => Promise<unknown>>(),
  getMyNotificationTargetV2: vi.fn<() => Promise<unknown>>(),
  getMyMatchNotificationContext: vi.fn<() => Promise<unknown>>(),
  markNotificationRead: vi.fn<() => Promise<unknown>>(),
  acceptMyNotificationInvitation: vi.fn<() => Promise<unknown>>()
}));
import { NotificationDetailPage } from '../src/features/notifications/NotificationDetailPage';

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('management notification SQL / renderer parity', () => {
  let fixtures: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  beforeAll(async () => {
    // Missing infrastructure is failed proof, never a skipped parity test.
    if (!environment.env)
      throw new Error('Local Supabase required for management notification parity');
    fixtures = await createMatchManagementFixtures(environment.env);
  });
  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it('every management kind resolves recipient target and context without allowlist drift', async () => {
    const recipient = await fixtures.member();
    const foreign = await fixtures.member();
    const event = await fixtures.event({ invites: [recipient], inviteOnly: true });
    const renderer = readFileSync('src/features/notifications/NotificationDetailPage.tsx', 'utf8');
    const frontendKinds = [
      ...renderer.matchAll(
        /'((?:match_registration|match_invitation|match_reconfirmation|match_event)_[a-z_]+)'/g
      )
    ].map((match) => match[1]!);
    const sqlKinds = (definition: string) =>
      [
        ...new Set(
          [...definition.matchAll(/'(match_[a-z_]+)'/g)]
            .map((match) => match[1]!)
            .filter((kind) => kind !== 'match_event' && kind !== 'match_available')
        )
      ].sort();
    const definitions =
      await sqlRows(`select proname,pg_get_functiondef(oid) as definition from pg_proc
      where oid in ('public.get_my_notification_target_v2(uuid)'::regprocedure,
      'public.get_my_match_notification_contexts(uuid[])'::regprocedure)`);
    expect(definitions).toHaveLength(2);
    // Exact set comparison catches both missing and extra kinds, not only the
    // current twelve management additions. It uses installed SQL, not migration text.
    for (const row of definitions)
      expect(sqlKinds(String(row.definition)), `SQL reader: ${String(row.proname)}`).toEqual(
        [...new Set(frontendKinds)].sort()
      );

    const ids = Object.entries(MANAGEMENT_NOTIFICATION_COPY).map(([kind, body]) => ({
      kind,
      body,
      id: crypto.randomUUID()
    }));
    await fixtureSql(`insert into public.notifications(id,recipient_user_id,event_key,kind,category,target_type,target_id,community_id)
      values ${ids.map(({ kind, id }) => `('${id}','${recipient.id}','paf6.parity:${id}','${kind}','matches','match_event','${event.id}','${fixtures.communityId}')`).join(',')};`);
    for (const { kind, body, id } of ids) {
      const targetResult = await recipient.client
        .rpc('get_my_notification_target_v2', { p_notification_id: id })
        .single();
      expect(targetResult.error, `Target: ${kind}`).toBeNull();
      // Same recipient-scoped header enrichment as getMyNotificationTargetV2:
      // SQL target intentionally omits kind and community identity for matches.
      const header = await recipient.client
        .from('notifications')
        .select('kind,created_at')
        .eq('id', id)
        .single();
      expect(header.error).toBeNull();
      expect(header.data?.kind).toBe(kind);
      const target = decodeNotificationTarget({ ...targetResult.data!, ...header.data! });
      expect(target, `Target: ${kind}`).toMatchObject({
        kind,
        target_status: 'match_available',
        match_available: true,
        match_event_id: event.id
      });
      const contexts = await recipient.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [id]
      });
      expect(contexts.error, `Context: ${kind}`).toBeNull();
      expect(contexts.data, `Context: ${kind}`).toHaveLength(1);
      const context = contexts.data![0]!;
      expect(context).toMatchObject({
        match_event_id: event.id,
        venue: 'Invitation court',
        event_status: 'open',
        accepted_count: 1,
        reconfirmation_required_count: 0
      });
      expect(context).not.toHaveProperty('removal_reason');
      expect(context).not.toHaveProperty('target_user_id');
      for (const locale of ['en', 'pt-BR', 'es'] as const) {
        const i18n = createI18n(locale);
        const html = renderToStaticMarkup(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(NotificationDetailPage, {
              notificationId: id,
              target,
              matchContext: context
            })
          )
        );
        expect(html, `${locale} ${kind} body`).toContain(
          renderToStaticMarkup(createElement('p', null, i18n.t(`notifications.match.${body}`)))
        );
        expect(/<h1\b[^>]*>(.*?)<\/h1>/.exec(html)?.[1], `${locale} ${kind} heading`).toBe(
          renderToStaticMarkup(createElement('h1', null, i18n.t(`notifications.kinds.${kind}`)))
            .replace('<h1>', '')
            .replace('</h1>', '')
        );
      }
      expect(
        (await foreign.client.rpc('get_my_notification_target_v2', { p_notification_id: id })).error
          ?.code,
        `Foreign target: ${kind}`
      ).toBe('42501');
      const foreignContext = await foreign.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [id]
      });
      expect(foreignContext.error).toBeNull();
      expect(foreignContext.data).toEqual([]);
    }

    const cancellation = await fixtures.creator.client.rpc('cancel_match_event', {
      p_match_event_id: event.id,
      p_expected_version: 1,
      p_reason: 'Court closed',
      p_request_id: crypto.randomUUID()
    });
    expect(cancellation.error).toBeNull();
    const cancelled = await recipient.client
      .from('notifications')
      .select('id')
      .eq('target_id', event.id)
      .eq('kind', 'match_event_cancelled')
      .neq('id', ids.find((row) => row.kind === 'match_event_cancelled')!.id)
      .single();
    expect(cancelled.error).toBeNull();
    const tombstone = await recipient.client
      .rpc('get_my_notification_target_v2', { p_notification_id: cancelled.data!.id })
      .single();
    expect(tombstone.error).toBeNull();
    expect(tombstone.data).toMatchObject({
      target_status: 'match_available',
      match_event_id: event.id
    });
    const context = await recipient.client.rpc('get_my_match_notification_contexts', {
      p_notification_ids: [cancelled.data!.id]
    });
    expect(context.error).toBeNull();
    expect(context.data?.[0]).toMatchObject({
      event_status: 'cancelled',
      match_event_id: event.id
    });
  });
});
