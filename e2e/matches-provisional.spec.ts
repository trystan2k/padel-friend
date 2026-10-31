import { expect, test, type Page } from '@playwright/test';
import { en, fill, fixtures, organizerMenu, sql } from './matches-management-fixtures';

// Add-player journey up to the provisional badge. The claim leg (invite link ->
// restricted onboarding -> claim -> badge removed -> history access) extends this
// spec in the claim unit.
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
