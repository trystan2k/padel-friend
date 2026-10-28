import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { matchPhotoFixture } from '../test/helpers/match-photo-fixtures';
import { waitForHydratedPage } from './auth-helpers';
import { serializeMatchFixtureSql } from './match-fixture-sql';
import enCopy from '../src/locales/en/translation.json' with { type: 'json' };
import ptCopy from '../src/locales/pt-BR/translation.json' with { type: 'json' };
import esCopy from '../src/locales/es/translation.json' with { type: 'json' };

export const en = enCopy;
export const copies = { en: enCopy, 'pt-BR': ptCopy, es: esCopy };
export const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), text);
export type Actor = { id: string; email: string; name: string; client: SupabaseClient };
export const visualEventId = '550e8400-e29b-41d4-a716-446655440000';
type EventOptions = {
  id?: string;
  price_minor?: number;
  currency?: string;
  payment_note?: string;
  court_notes?: string;
  maps_url?: string;
  maximum_registrations?: number;
};
const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;
type Row = Record<string, unknown>;

// Same local CLI/SQL boundary as matches-registration.spec.ts. No Vitest imports
// (the integration SQL helper imports Vitest and cannot run in Playwright).
export async function sql(query: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', [
      'exec',
      'supabase',
      'db',
      'query',
      '--local',
      '--output-format',
      'json',
      serializeMatchFixtureSql(query)
    ]);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Local SQL failed (${code}): ${out}\n${err}`));
        return;
      }
      const start = out.indexOf('[');
      const end = out.lastIndexOf(']');
      if (start < 0) {
        resolve([]);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(out.slice(start, end + 1));
        if (
          !Array.isArray(parsed) ||
          !parsed.every(
            (row): row is Row => typeof row === 'object' && row !== null && !Array.isArray(row)
          )
        )
          throw new Error('Invalid local SQL row response');
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function fixtures(
  browser: Browser,
  identities: {
    creatorName?: string;
    memberNames?: string[];
    memberCount?: number;
    communityName?: string;
  } = {}
) {
  const vars = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((s) => s.includes('=') && !s.startsWith('#'))
      .map((s) => [
        s.slice(0, s.indexOf('=')).trim(),
        s
          .slice(s.indexOf('=') + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
      ])
  );
  const url = process.env.VITE_SUPABASE_URL ?? vars.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? vars.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  const actors: Actor[] = [];
  const contexts: BrowserContext[] = [];
  const photos: string[] = [];
  async function actor(name: string) {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const email = `match-management-${crypto.randomUUID()}@test.local`;
    const result = await client.auth.signUp({ email, password: 'Password123!' });
    if (result.error || !result.data.session || !result.data.user)
      throw result.error ?? new Error('No local session');
    const who = { id: result.data.user.id, email, name, client };
    actors.push(who);
    const onboard = await client.rpc('onboard_player', {
      p_display_name: name,
      p_preferred_side: 'EITHER',
      p_initial_level: 3.2
    });
    if (onboard.error) throw onboard.error;
    return who;
  }
  const creator = await actor(identities.creatorName ?? 'Management Host');
  const created = await creator.client.rpc('create_community', {
    p_name: identities.communityName ?? `Management ${crypto.randomUUID().slice(0, 8)}`,
    p_visibility: 'public',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('No community');
  const community = created.data;
  const members: Actor[] = [];
  for (let i = 1; i <= (identities.memberCount ?? 10); i++) {
    const member = await actor(identities.memberNames?.[i - 1] ?? `Management Player ${i}`);
    const joined = await member.client.rpc('join_public_community', { p_community_id: community });
    if (joined.error) throw joined.error;
    members.push(member);
  }
  const guest = await actor('Management Guest');
  async function page(
    who: Actor,
    locale: keyof typeof copies = 'en',
    width = 390,
    theme: 'light' | 'dark' = 'light',
    height = 844
  ) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      // Chromium requires explicit permission for signed local Storage images.
      permissions: ['local-network-access'],
      serviceWorkers: 'block'
    });
    contexts.push(context);
    await context.addCookies([
      { name: 'locale', value: locale, url: 'http://127.0.0.1:4173' },
      { name: 'theme', value: theme, url: 'http://127.0.0.1:4173' }
    ]);
    const p = await context.newPage();
    await p.goto('/login');
    await waitForHydratedPage(p);
    const copy = copies[locale];
    await p.getByLabel(copy.auth.loginEmailLabel).fill(who.email);
    await p.getByLabel(copy.auth.loginPasswordLabel).fill('Password123!');
    await p.getByRole('button', { name: copy.auth.loginSubmit }).click();
    await expect(p).toHaveURL(/\/dashboard$/);
    await waitForHydratedPage(p);
    return p;
  }
  async function event(
    count = 9,
    invites: Actor[] = [],
    capacity: number | null = null,
    options: EventOptions = {}
  ) {
    const id = options.id ?? crypto.randomUUID();
    const photoPath = matchPhotoFixture(community, id, creator.id).path.replace(/\.webp$/, '.jpg');
    // Pinned source photo: no network dependency during browser certification.
    const uploaded = await creator.client.storage
      .from('match-event-photos')
      .upload(
        photoPath,
        readFileSync(new URL('../test/helpers/fixtures/venue-court.jpg', import.meta.url)),
        { contentType: 'image/jpeg' }
      );
    if (uploaded.error) throw uploaded.error;
    photos.push(photoPath);
    await sql(`do $$ begin
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,restriction_enabled,maximum_registrations,registration_cutoff_at,price_minor,currency,payment_note,court_notes)
      values ('${id}','${community}','${creator.id}','2030-11-01T22:00:00Z','UTC','friendly','community_open','POST_MATCH_TEAMS','Management court',${sqlText(options.maps_url ?? 'https://maps.google.com/maps/place/management')},'${photoPath}',false,${options.maximum_registrations ?? capacity ?? 'null'},'2030-10-31T22:00:00Z',${options.price_minor ?? 'null'},${options.currency ? sqlText(options.currency) : 'null'},${options.payment_note ? sqlText(options.payment_note) : 'null'},${options.court_notes ? sqlText(options.court_notes) : 'null'});
      ${members
        .slice(0, count - 1)
        .map(
          (a) =>
            `perform set_config('request.jwt.claim.sub','${a.id}',true); perform public.submit_match_registration('${id}');`
        )
        .join('\n')}
      ${invites.map((a) => `insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) values ('${id}','${a.id}','${creator.id}');`).join('\n')}
      end $$;`);
    return id;
  }
  async function open(p: Page, id: string) {
    await p.goto(`/matches/${id}`);
    await waitForHydratedPage(p);
  }
  async function rpc(who: Actor, name: string, args: Record<string, unknown>) {
    const result = await who.client.rpc(name, args);
    expect(result.error, name).toBeNull();
    return result.data as unknown;
  }
  async function attempt(id: string, who: Actor) {
    const rows = await sql(
      `select current_attempt_id::text as id from public.match_event_registrations where match_event_id='${id}' and user_id='${who.id}'`
    );
    return String(rows[0]?.id);
  }
  async function notifications(who: Actor, kind: string, id: string) {
    const result = await who.client
      .from('notifications')
      .select('id')
      .eq('kind', kind)
      .eq('target_id', id);
    if (result.error) throw result.error;
    return result.data ?? [];
  }
  async function notice(
    p: Page,
    who: Actor,
    kind: keyof typeof en.notifications.kinds,
    id: string
  ) {
    const rows = await notifications(who, kind, id);
    expect(rows).toHaveLength(1);
    await p.goto(`/notifications/${rows[0]!.id}`);
    await waitForHydratedPage(p);
    await expect(
      p.getByRole('heading', {
        level: 1,
        name: en.notifications.kinds[kind]
      })
    ).toBeVisible();
    await p.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(p).toHaveURL(new RegExp(`/matches/${id}$`));
    await waitForHydratedPage(p);
  }
  async function cutoff(id: string) {
    // One narrow fixture transaction: legitimate DB-clock deadline, unchanged
    // future start, production internal processor; no clock/GUC overrides.
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
    end $$;`);
    try {
      await sql(`do $$ begin
        update public.match_events
           set registration_cutoff_at=clock_timestamp()-interval '1 minute'
         where id='${id}';
        perform public.process_match_event_registration_cutoff('${id}');
      end $$;`);
    } finally {
      await sql(`do $$ begin
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    }
  }
  async function clearEvents() {
    // Scoped counterpart of test/helpers/match-management-fixtures.ts cleanup.
    const resultGuards = `do $$ begin
      alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
      alter table public.match_event_result_reviews disable trigger match_result_review_immutable;
      alter table public.match_event_result_proposals disable trigger match_result_proposal_transition_guard;
      alter table public.match_event_result_proposals disable trigger match_result_proposal_pointer_integrity;
      alter table public.match_event_result_confirmations disable trigger match_result_confirmation_insert_guard;
      alter table public.match_event_result_confirmations disable trigger match_result_confirmation_pointer_integrity;
    end $$;`;
    const restoreResultGuards = `do $$ begin
      alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;
      alter table public.match_event_result_reviews enable trigger match_result_review_immutable;
      alter table public.match_event_result_proposals enable trigger match_result_proposal_transition_guard;
      alter table public.match_event_result_proposals enable trigger match_result_proposal_pointer_integrity;
      alter table public.match_event_result_confirmations enable trigger match_result_confirmation_insert_guard;
      alter table public.match_event_result_confirmations enable trigger match_result_confirmation_pointer_integrity;
    end $$;`;
    await sql(resultGuards);
    try {
      await sql(`do $$ begin
      -- Parent-first relation locks match the registration/submission writers.
      lock table public.match_events, public.match_event_registration_state in share row exclusive mode;
      alter table public.match_events disable trigger match_event_immutable;
      alter table public.match_event_invites disable trigger match_invite_immutable;
      alter table public.match_event_registrations disable trigger match_registration_identity_guard;
      alter table public.match_event_registration_attempts disable trigger match_attempt_history_guard;
      alter table public.match_event_registration_attempts disable trigger match_attempt_final_state;
      alter table public.match_event_registrations disable trigger match_registration_final_state;
      alter table public.match_event_audit_log disable trigger match_audit_immutable;
      -- Delete only lifecycle rows attached to this fixture's owned events.
      delete from public.notifications where community_id='${community}';
      delete from public.match_event_result_processing_state where proposal_id in (
        select id from public.match_event_result_proposals where match_event_id in
          (select id from public.match_events where community_id='${community}')
      );
      delete from public.match_event_result_reviews where proposal_id in (
        select id from public.match_event_result_proposals where match_event_id in
          (select id from public.match_events where community_id='${community}')
      );
      delete from public.match_event_audit_log where community_id='${community}';
      delete from public.match_event_result_confirmations where match_event_id in
        (select id from public.match_events where community_id='${community}');
      delete from public.match_event_result_proposal_versions where proposal_id in (
        select id from public.match_event_result_proposals where match_event_id in
          (select id from public.match_events where community_id='${community}')
      );
      delete from public.match_event_result_proposals where match_event_id in
        (select id from public.match_events where community_id='${community}');
      delete from public.match_event_invites where match_event_id in (select id from public.match_events where community_id='${community}');
      delete from public.match_event_management_commands where match_event_id in (select id from public.match_events where community_id='${community}');
      update public.match_event_registrations set current_attempt_id=null where match_event_id in (select id from public.match_events where community_id='${community}');
      delete from public.match_event_registration_attempts where match_event_id in (select id from public.match_events where community_id='${community}');
      delete from public.match_event_registrations where match_event_id in (select id from public.match_events where community_id='${community}');
      delete from public.match_event_registration_state where match_event_id in (select id from public.match_events where community_id='${community}');
      delete from public.match_events where community_id='${community}';
      -- Force deferred FK/pointer checks before restoring the table guards in
      -- the following transaction; otherwise PostgreSQL rejects ALTER TABLE.
      set constraints all immediate;
      alter table public.match_events enable trigger match_event_immutable;
      alter table public.match_event_invites enable trigger match_invite_immutable;
      alter table public.match_event_registrations enable trigger match_registration_identity_guard;
      alter table public.match_event_registrations enable trigger match_registration_final_state;
      alter table public.match_event_registration_attempts enable trigger match_attempt_history_guard;
      alter table public.match_event_registration_attempts enable trigger match_attempt_final_state;
      alter table public.match_event_audit_log enable trigger match_audit_immutable;
      end $$;`);
    } finally {
      // DDL restoration runs after the deletion transaction commits/rolls back;
      // PostgreSQL rejects trigger DDL while deferred FK events are pending.
      await sql(restoreResultGuards);
    }
    // Delete real bytes through Storage after event detachment commits, while
    // creator membership still permits deletion. SQL-only metadata deletion
    // would orphan physical objects on the local storage backend.
    if (photos.length) {
      const removed = await creator.client.storage.from('match-event-photos').remove(photos);
      if (removed.error) throw removed.error;
      expect(removed.data.map((photo) => photo.name).sort()).toEqual([...photos].sort());
      photos.length = 0;
    }
  }
  async function cleanup() {
    await Promise.all(contexts.map((c) => c.close()));
    await clearEvents();
    await sql(`do $$ begin
      lock table public.communities in share row exclusive mode;
      alter table public.community_members disable trigger community_member_guard;
      delete from public.community_members where community_id='${community}';
      delete from public.community_audit_log where community_id='${community}';
      delete from public.communities where id='${community}';
      delete from auth.users where id in (${actors.map((a) => `'${a.id}'`).join(',')});
      alter table public.community_members enable trigger community_member_guard;
      end $$;`);
  }
  return {
    creator,
    members,
    guest,
    community,
    event,
    page,
    open,
    rpc,
    attempt,
    notifications,
    notice,
    cutoff,
    clearEvents,
    cleanup
  };
}

export async function organizerMenu(page: Page, item: string) {
  await page.getByRole('button', { name: en.matches.management.actions, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
