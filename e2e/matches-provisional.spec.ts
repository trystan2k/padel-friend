import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page
} from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  en,
  fill,
  fixtures,
  organizerMenu,
  sql,
  sqlWithFixtureTriggersDisabled
} from './matches-management-fixtures';

// Add-player journey: organizer adds a player, the invitation mail's link opens the
// restricted claim onboarding (prefilled), the claim clears the badge, and the claimed
// player reads the history they took part in.
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
let f: Awaited<ReturnType<typeof fixtures>>;
const added: string[] = [];
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await fixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  // The provisional profile references its source event and registrations reference the
  // user: drop the profile first, let the fixture drop the events, then the identity.
  const ids = (email: string) => `(select id from auth.users where email='${email}')`;
  for (const email of added)
    await sql(`do $$ begin
      delete from public.match_player_add_recipient_sends where operation_id in (select id from public.match_player_add_operations where actor_id='${f.creator.id}');
      delete from public.match_player_add_throttle_hits where actor_id='${f.creator.id}';
      delete from public.match_player_add_actor_windows where actor_id='${f.creator.id}';
      delete from public.match_player_add_operations where actor_id='${f.creator.id}';
      alter table public.player_profiles disable trigger player_profile_provenance_guard;
      delete from public.player_profiles where user_id in ${ids(email)};
      alter table public.player_profiles enable trigger player_profile_provenance_guard;
      alter table public.community_members disable trigger community_member_guard;
      delete from public.community_members where user_id in ${ids(email)};
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  await f?.cleanup();
  for (const email of added)
    await sql(`do $$ begin
      delete from auth.users where email='${email}';
    end $$;`);
});
test.beforeEach(() => {
  test.setTimeout(90_000);
});
const a = en.matches.addPlayer;

async function openDialog(page: Page) {
  await organizerMenu(page, a.action);
  const dialog = page.getByRole('dialog', { name: a.title });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function add(page: Page, name: string, email: string, level: string) {
  const dialog = await openDialog(page);
  await dialog.getByLabel(a.nameLabel).fill(name);
  await dialog.getByLabel(a.emailLabel).fill(email);
  await dialog.getByRole('slider').fill(level);
  await dialog.getByRole('button', { name: a.submit, exact: true }).click();
  return dialog;
}

test('owner sees dialog validation before any request', async () => {
  const id = await f.event(3);
  const page = await f.page(f.creator);
  await f.open(page, id);
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: a.submit, exact: true }).click();
  for (const message of Object.values(a.validation))
    await expect(dialog.getByRole('alert').filter({ hasText: message })).toBeVisible();
  await expect(dialog.getByLabel(a.nameLabel)).toBeFocused();
  await dialog.getByRole('button', { name: a.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: en.matches.management.actions, exact: true })
  ).toBeFocused();
});

test('owner adds an unregistered player, success copy is uniform and the roster shows the badge', async () => {
  const id = await f.event(3);
  const page = await f.page(f.creator);
  await f.open(page, id);
  const email = `add-ui-${crypto.randomUUID()}@test.local`;
  added.push(email);
  const dialog = await add(page, 'Marta Provisional', email, '3.5');
  await expect(dialog).toHaveCount(0);
  const success = fill(a.success, { name: 'Marta Provisional' });
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  await expect(page.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(1);
  const rows = await sql(
    `select p.is_provisional::text, r.lifecycle::text from auth.users u
       join public.player_profiles p on p.user_id=u.id
       join public.match_event_registrations r on r.user_id=u.id and r.match_event_id='${id}'
      where u.email='${email}'`
  );
  expect(rows).toEqual([{ is_provisional: 'true', lifecycle: 'accepted' }]);

  // A registered email yields the same copy and exposes no branch: no badge, no extra row.
  const known = await add(page, 'Known Player', f.members[0]!.email, '4');
  await expect(known).toHaveCount(0);
  await expect(
    page.getByText(fill(a.success, { name: 'Known Player' }), { exact: true })
  ).toBeVisible();
  await expect(page.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(1);
});

test('members without management rights never see the entry point', async () => {
  const id = await f.event(3);
  const page = await f.page(f.members[0]!);
  await f.open(page, id);
  await expect(
    page.getByRole('button', { name: en.matches.management.actions, exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: a.action })).toHaveCount(0);
});

const MAILPIT_URL = 'http://127.0.0.1:55324';

async function mailpitJson(response: APIResponse): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error('Unexpected Mailpit response');
  return Object.fromEntries(Object.entries(body));
}

/** The invitation link of the single mail delivered to `email`, as a mail client opens it. */
async function invitationLink(request: APIRequestContext, email: string) {
  const search = await request.get(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`
  );
  const messages = (await mailpitJson(search)).messages;
  if (!Array.isArray(messages)) throw new Error('Unexpected Mailpit search response');
  expect(messages).toHaveLength(1);
  const message = await request.get(
    `${MAILPIT_URL}/api/v1/message/${String(Reflect.get(messages[0], 'ID'))}`
  );
  const HTML = (await mailpitJson(message)).HTML;
  if (typeof HTML !== 'string') throw new Error('Unexpected Mailpit message response');
  const links = [...HTML.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&')
  );
  expect(links).toHaveLength(1);
  return links[0]!;
}

test('added player opens the invitation, claims the prefilled profile and gains history access', async ({
  browser,
  request
}) => {
  test.setTimeout(150_000);
  const id = await f.event(3);
  const pastId = crypto.randomUUID();
  const organizer = await f.page(f.creator);
  await f.open(organizer, id);
  const email = `claim-ui-${crypto.randomUUID()}@test.local`;
  added.push(email);
  const dialog = await add(organizer, 'Carla Convidada', email, '3.5');
  await expect(dialog).toHaveCount(0);
  await expect(organizer.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(1);
  const userId = String(
    (await sql(`select id::text from auth.users where email='${email}'`))[0]?.id
  );

  // A closed, private past event the player took part in: only participation grants it.
  await f.event(0, [], null, { id: pastId });
  await sqlWithFixtureTriggersDisabled(
    ['matchEventImmutable'],
    [
      `update public.match_events set visibility='invite_only', venue_name='Past private court',
         starts_at=now()-interval '2 hours', registration_cutoff_at=now()-interval '3 hours' where id='${pastId}'`
    ]
  );
  await sql(`do $$ begin
    insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source)
      select '${pastId}','${userId}',clock_timestamp(),coalesce(max(accepted_order),0)+1,'reserve','member'
        from public.match_event_registrations where match_event_id='${pastId}';
    insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,accepted_at,accepted_order,registration_source)
      select id,match_event_id,user_id,accepted_at,accepted_at,'accepted',user_id,accepted_at,accepted_order,registration_source
        from public.match_event_registrations where match_event_id='${pastId}' and user_id='${userId}';
    update public.match_event_registrations r set current_attempt_id=a.id
      from public.match_event_registration_attempts a
      where a.registration_id=r.id and r.match_event_id='${pastId}' and r.user_id='${userId}';
  end $$;`);

  // The invitation link goes through the real callback and lands on the restricted claim form.
  const link = await invitationLink(request, email);
  expect(new URL(link).origin).toBe('http://127.0.0.1:4173');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block'
  });
  try {
    const player = await context.newPage();
    await player.goto(link);
    await expect(player).toHaveURL(/\/onboarding\?next=/);
    await waitForHydratedPage(player);
    const claim = en.auth.claim;
    await expect(player.getByRole('heading', { level: 1, name: claim.title })).toBeVisible();
    await expect(player.getByLabel(en.onboarding.name)).toHaveValue('Carla Convidada');
    await expect(player.getByLabel(en.onboarding.preciseLevel)).toHaveValue('3.5');

    // Nothing else is reachable before the claim: other pages send the player back here.
    const probe = await context.newPage();
    await probe.goto(`/matches/${pastId}`);
    await expect(probe).toHaveURL(/\/onboarding/);
    await probe.close();

    await player.getByLabel(en.onboarding.name).fill('Carla Reclamada');
    await player.getByLabel(en.onboarding.sideLeftShort).first().check();
    await player.getByRole('button', { name: claim.submit }).click();
    await expect(player).toHaveURL(new RegExp(`/matches/${id}$`));
    await waitForHydratedPage(player);
    await expect(player.getByText('Management court').first()).toBeVisible();

    // Same identity, marker cleared, history reachable; the claim is audited once.
    const rows = await sql(
      `select p.is_provisional::text as provisional, p.display_name,
              (select count(*)::int from auth.users where email='${email}') as accounts,
              (select count(*)::int from public.match_event_audit_log where target_user_id=p.user_id and action='player_claimed') as audits
         from public.player_profiles p where p.user_id='${userId}'`
    );
    expect(rows).toEqual([
      { provisional: 'false', display_name: 'Carla Reclamada', accounts: 1, audits: 1 }
    ]);
    await player.goto(`/matches/${pastId}`);
    await waitForHydratedPage(player);
    await expect(player.getByText('Past private court').first()).toBeVisible();
    await player.goto('/dashboard');
    await expect(player).toHaveURL(/\/dashboard$/);
  } finally {
    await context.close();
  }

  // The organizer's roster no longer flags the claimed player.
  await f.open(organizer, id);
  await expect(organizer.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(0);
  await expect(organizer.getByText('Carla Reclamada').first()).toBeVisible();
});

test('a spent or forged invitation link never opens a session', async ({ page }) => {
  await page.goto('/auth/callback?token_hash=deadbeefdeadbeefdeadbeef&type=invite&next=/dashboard');
  await expect(page).toHaveURL(/\/login\?authError=1/);
});
