import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  copies,
  en as defaultCopy,
  fill,
  fixtures,
  sql,
  visualEventId
} from './matches-management-fixtures';
import manifestJson from './references/paf-6/manifest.json' with { type: 'json' };
import resultManifest from './references/paf-7/manifest.json' with { type: 'json' };

// Reference-only certification. No snapshots are generated or updated here.
// Rebuilt frames include app chrome at their manifest-owned heights; 320px, desktop, dark and translated
// variants below receive structural gates ONLY, not fabricated pixel baselines.
// Per-screen tolerances remain manifest-owned. Null means BLOCKED, not zero or
// an inherited PAF-5 budget. Captures are evidence attachments, never baselines.
const manifest: {
  sourceDesign: { path: string; sha256: string };
  approvedReferences: Record<
    string,
    { sha256: string; sourceSize: string; maskRegions?: MaskRegion[] }
  >;
  visualBudgets: {
    perScreen: Record<
      string,
      {
        measured: number | null;
        budget: number | null;
        baselineSha256: string | null;
      }
    >;
  };
} = {
  ...manifestJson,
  approvedReferences: {
    ...manifestJson.approvedReferences,
    'iXRPp.png': {
      sha256: resultManifest.approvedReferences['iXRPp.png'].sha256,
      sourceSize: resultManifest.approvedReferences['iXRPp.png'].pixelSize
        .map((size) => size / 2)
        .join('x'),
      maskRegions: resultManifest.approvedReferences['iXRPp.png'].maskRegions
    }
  },
  visualBudgets: {
    perScreen: {
      ...manifestJson.visualBudgets.perScreen,
      'iXRPp.png': {
        measured: null,
        budget: resultManifest.visualBudgets.perScreen.iXRPp,
        baselineSha256: resultManifest.approvedReferences['iXRPp.png'].sha256
      }
    }
  }
};
type MaskRegion = { x: number; y: number; width: number; height: number };
const frames = [
  ['invitation-pending', 'Fyhbv'],
  ['minor-edit', 'lJHUZ'],
  ['major-change', 't0SZec'],
  ['player-required', 'oVtuS'],
  ['reconfirmation-excluded', 'uiRqp'],
  ['removal-reason-dialog', 'q2TCnQ'],
  ['cancel', 'Ht2Oq'],
  ['transfer', 'm7hh3'],
  ['cutoff-unavailable', 'dmvWu'],
  ['invitation-accepted', 'YvdPB'],
  ['invitation-declined', 'M7ighq'],
  ['invitation-expired', 'T7T2U'],
  ['creator-action-menu', 'bobgm'],
  ['organizer-only', 'PKM0u'],
  ['cancelled-tombstone', 'K23bLC'],
  ['minor-edit-conflict', 'Tm3XM'],
  ['creator-required', 'xgKXg'],
  ['started-unavailable', 'iXRPp'],
  ['result-protected-unavailable', 'a6xmFd']
] as const;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function reference(frame: string) {
  const filename = `${frame}.png`;
  const folder = frame === 'iXRPp' ? 'paf-7' : 'paf-6';
  const bytes = readFileSync(new URL(`./references/${folder}/${filename}`, import.meta.url));
  expect(hash(bytes), `${frame} approved reference digest`).toBe(
    manifest.approvedReferences[filename]!.sha256
  );
  return bytes;
}

function provenance() {
  // Opaque byte digest only; encrypted design content is never decoded/parsed.
  expect(hash(readFileSync(manifest.sourceDesign.path)), 'Unchanged approved source design').toBe(
    manifest.sourceDesign.sha256
  );
}

let f: Awaited<ReturnType<typeof fixtures>>;
test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', serviceWorkers: 'block' });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  provenance();
  f = await fixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(120_000);
});

async function bounds(page: Page, copy = defaultCopy) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth
  }));
  expect
    .soft(overflow.document, 'No horizontal document overflow')
    .toBeLessThanOrEqual(overflow.viewport);
  const controls = page
    .getByRole('dialog')
    .or(page.getByRole('menu'))
    .or(page.getByRole('region', { name: copy.matches.invitations.title }))
    .or(page.getByRole('region', { name: copy.matches.reconfirmation.title }));
  const root = (await controls.count()) ? controls.first() : page.getByRole('main');
  const panelOverflow = await root.evaluate((element) => ({
    content: element.scrollWidth,
    viewport: element.clientWidth
  }));
  expect
    .soft(panelOverflow.content, 'No horizontal panel/dialog overflow')
    .toBeLessThanOrEqual(panelOverflow.viewport);
  const hitBounds = await root
    .locator(
      'button:visible, a:visible, input:visible, select:visible, textarea:visible, [role="menuitem"]:visible'
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
          width: rect.width,
          height: rect.height
        };
      })
    );
  for (const bound of hitBounds) {
    expect.soft(bound.width, `${bound.label} hit width`).toBeGreaterThanOrEqual(44);
    expect.soft(bound.height, `${bound.label} hit height`).toBeGreaterThanOrEqual(44);
  }
}

async function prepare(
  state: (typeof frames)[number][0],
  variant = { width: 390, locale: 'en' as keyof typeof copies, theme: 'light' as 'light' | 'dark' },
  height = 844
) {
  // Fixed frame UUID must remain isolated across sequential states. Clear only
  // this suite's community-owned events and detached Storage objects.
  await f.clearEvents();
  const copy = copies[variant.locale];
  const invited = f.members[8]!;
  const count =
    state === 'reconfirmation-excluded' ? 5 : state === 'removal-reason-dialog' ? 10 : 9;
  const invitationState = state.startsWith('invitation-');
  const id = await f.event(
    state === 'invitation-accepted' ? 6 : count,
    invitationState ? [invited] : [],
    null,
    {
      id: visualEventId,
      ...(state === 'minor-edit-conflict'
        ? {
            price_minor: 850,
            currency: 'EUR',
            payment_note: 'Pay at venue',
            court_notes: 'Court 4',
            maps_url: 'https://maps.google.com/../management',
            maximum_registrations: 10
          }
        : {})
    }
  );
  const playerState = [
    'invitation-pending',
    'invitation-accepted',
    'invitation-declined',
    'invitation-expired',
    'player-required',
    'reconfirmation-excluded'
  ].includes(state);
  const who = playerState ? invited : f.creator;
  // Consent states use an actually accepted player (ninth acceptance), not invitee #10.
  const actor =
    state === 'reconfirmation-excluded'
      ? f.members[3]!
      : state === 'player-required'
        ? f.members[7]!
        : who;
  if (
    state === 'player-required' ||
    state === 'creator-required' ||
    state === 'reconfirmation-excluded'
  ) {
    await f.rpc(f.creator, 'edit_match_event', {
      p_match_event_id: id,
      p_expected_version: 1,
      p_patch: { event_type: 'competitive' },
      p_request_id: crypto.randomUUID()
    });
    if (state === 'reconfirmation-excluded') {
      for (const accepted of [f.creator, ...f.members.slice(0, 3)]) {
        await f.rpc(accepted, 'reconfirm_match_registration', {
          p_match_event_id: id,
          p_attempt_id: await f.attempt(id, accepted),
          p_generation: 1,
          p_request_id: crypto.randomUUID()
        });
      }
      await f.cutoff(id);
    }
  }
  if (state === 'cutoff-unavailable') await f.cutoff(id);
  if (state === 'creator-required') {
    // xgKXg: organizer already confirmed; eight confirmed, one outstanding.
    for (const accepted of [f.creator, ...f.members.slice(0, 7)]) {
      await f.rpc(accepted, 'reconfirm_match_registration', {
        p_match_event_id: id,
        p_attempt_id: await f.attempt(id, accepted),
        p_generation: 1,
        p_request_id: crypto.randomUUID()
      });
    }
  }
  if (state === 'invitation-expired') await f.cutoff(id);
  if (state === 'invitation-accepted' || state === 'invitation-declined') {
    const invitation = await sql(
      `select id::text from public.match_event_invites where match_event_id='${id}' and invitee_user_id='${invited.id}'`
    );
    await f.rpc(invited, 'respond_match_event_invitation', {
      p_match_event_id: id,
      p_invitation_id: invitation[0]!.id,
      p_response: state === 'invitation-accepted' ? 'accept' : 'decline'
    });
  }
  if (state === 'organizer-only')
    await f.rpc(f.creator, 'withdraw_match_registration', {
      p_match_event_id: id,
      p_attempt_id: await f.attempt(id, f.creator),
      p_request_id: crypto.randomUUID()
    });
  if (state === 'cancelled-tombstone') {
    await f.rpc(f.creator, 'cancel_match_event', {
      p_match_event_id: id,
      p_reason: 'Court closed',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    });
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set registration_cutoff_at=clock_timestamp()-interval '1 minute' where id='${id}';
      alter table public.match_events enable trigger match_event_immutable; end $$;`);
  }
  if (state === 'started-unavailable')
    await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
    update public.match_events set starts_at=clock_timestamp()-interval '1 minute', registration_cutoff_at=clock_timestamp()-interval '2 minutes' where id='${id}';
    alter table public.match_events enable trigger match_event_immutable;
    perform public.process_match_event_registration_cutoff('${id}'); end $$;`);
  if (state === 'result-protected-unavailable')
    await sql(`select public.protect_match_event_results('${id}')`);
  const page = await f.page(actor, variant.locale, variant.width, variant.theme, height);
  await f.open(page, id);
  const m = copy.matches.management;
  // Probe accessible controls before Base UI makes the background inert.
  const immutable = [
    'started-unavailable',
    'result-protected-unavailable',
    'cancelled-tombstone'
  ].includes(state);
  if (immutable) {
    await expect(page.getByRole('heading', { name: m.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: m.actions, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toHaveCount(0);
  } else if (!playerState) {
    await expect(page.getByRole('heading', { name: m.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: m.actions, exact: true })).toBeVisible();
    if (state !== 'cutoff-unavailable')
      await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toBeEnabled();
  }
  if (!immutable)
    await expect(
      page.getByRole('heading', { name: copy.matchRegistration.place.title, exact: true })
    ).toBeVisible();
  if (state === 'minor-edit' || state === 'major-change' || state === 'minor-edit-conflict') {
    await page.getByRole('button', { name: m.edit.title, exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (state === 'major-change')
      await dialog
        .getByRole('combobox', { name: copy.matchCreate.fields.type, exact: true })
        .selectOption('competitive');
    else
      await dialog.getByLabel(copy.matchCreate.fields.venueName, { exact: true }).fill('Court 4');
    // Fixed semantic field order; translated labels must never alter this order.
    expect
      .soft(
        await dialog.locator('input,select').evaluateAll((inputs) =>
          inputs.map((input) =>
            Array.from(input.closest('label')?.childNodes ?? [])
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent)
              .join('')
              .trim()
          )
        )
      )
      .toEqual([
        copy.matchCreate.fields.type,
        copy.matchCreate.fields.startsAt,
        copy.matchCreate.fields.venueName,
        copy.matchCreate.fields.mapsUrl,
        copy.matchCreate.fields.courtNotes,
        copy.matchCreate.fields.price,
        copy.matchCreate.fields.currency,
        copy.matchCreate.fields.paymentNote,
        copy.matchCreate.fields.notes,
        copy.matchCreate.fields.maximumRegistrations,
        copy.matchCreate.fields.cutoff
      ]);
    if (state === 'minor-edit-conflict') {
      await f.rpc(f.creator, 'edit_match_event', {
        p_match_event_id: id,
        p_expected_version: 1,
        p_patch: { notes: 'Another organizer tab saved this' },
        p_request_id: crypto.randomUUID()
      });
      await dialog.getByRole('button', { name: m.edit.save, exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText(m.edit.conflictTitle);
      await expect(
        dialog.getByLabel(copy.matchCreate.fields.venueName, { exact: true })
      ).toHaveValue('Court 4');
      await expect(dialog.getByRole('button', { name: m.edit.save, exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: m.edit.reload, exact: true })).toBeEnabled();
      // DB requires HTTPS URLs. Once conflict is established, retain the
      // frame's shortened URL as an unsaved draft, never bypass DB validation.
      await dialog
        .getByLabel(copy.matchCreate.fields.mapsUrl, { exact: true })
        .fill('maps.google.com/../management');
      await dialog.getByLabel(copy.matchCreate.fields.mapsUrl, { exact: true }).blur();
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
    }
  } else if (state === 'removal-reason-dialog') {
    await page
      .getByRole('button', { name: fill(m.participantActions, { name: f.members[0]!.name }) })
      .click();
    await page.getByRole('menuitem', { name: m.remove, exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel(m.reason, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: m.remove, exact: true })
    ).toBeDisabled();
  } else if (state === 'cancel' || state === 'transfer') {
    await page.getByRole('button', { name: m.actions, exact: true }).click();
    await page
      .getByRole('menuitem', { name: state === 'cancel' ? m.cancelMatch : m.transfer, exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (state === 'cancel')
      await expect(dialog.getByLabel(m.cancelReason, { exact: true })).toBeVisible();
    else await expect(dialog.getByLabel(m.newOrganizer, { exact: true })).toBeVisible();
  } else if (state === 'invitation-pending') {
    const panel = page.getByRole('region', { name: copy.matches.invitations.title });
    await expect(panel.getByRole('status')).toContainText(copy.matches.invitations.pending);
    expect
      .soft(await panel.getByRole('button').allTextContents())
      .toEqual([copy.matches.invitations.accept, copy.matches.invitations.decline]);
    // Fyhbv places both invitation actions above the fold. Presence somewhere
    // down a long detail page is not an equivalent screen composition.
    await expect
      .soft(panel.getByRole('button', { name: copy.matches.invitations.accept, exact: true }))
      .toBeInViewport();
    await expect
      .soft(panel.getByRole('button', { name: copy.matches.invitations.decline, exact: true }))
      .toBeInViewport();
    await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toHaveCount(0);
  } else if (
    state === 'invitation-accepted' ||
    state === 'invitation-declined' ||
    state === 'invitation-expired'
  ) {
    const status =
      state === 'invitation-accepted'
        ? 'accepted'
        : state === 'invitation-declined'
          ? 'declined'
          : 'expired';
    const panel = page.getByRole('region', {
      name: copy.matches.detail.statusTitles[status],
      exact: true
    });
    await expect(panel).toContainText(copy.matches.invitations[status]);
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toHaveCount(0);
    const registrations = await sql(
      `select accepted_order::int, participation_status::text from public.match_event_registrations where match_event_id='${id}' and user_id='${invited.id}'`
    );
    if (status === 'accepted')
      expect(registrations).toEqual([{ accepted_order: 7, participation_status: 'reserve' }]);
    else expect(registrations).toHaveLength(0);
  } else if (state === 'creator-action-menu') {
    await page.getByRole('button', { name: m.actions, exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.getByRole('menuitem').allTextContents()).toEqual([m.transfer, m.cancelMatch]);
  } else if (state === 'organizer-only') {
    await expect(page.getByText(m.organizerOnly, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: m.leave, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toBeEnabled();
  } else if (state === 'cancelled-tombstone') {
    await expect(
      page.getByRole('heading', { name: copy.matches.detail.statusTitles.cancelled, exact: true })
    ).toBeVisible();
    await expect(page.getByText(m.unavailable.cancelled, { exact: true }).first()).toBeVisible();
    for (const label of [m.actions, m.edit.title, m.leave])
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  } else if (state === 'creator-required') {
    const panel = page.getByRole('region', { name: copy.matches.reconfirmation.title });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(panel.getByRole('listitem')).toContainText(f.members[7]!.name);
    await expect(
      panel.getByRole('button', { name: copy.matches.reconfirmation.reviewTerms, exact: true })
    ).toHaveCount(0);
    expect(
      (
        await sql(
          `select count(*)::int as n from public.match_event_registrations where match_event_id='${id}' and participation_status='playing'`
        )
      )[0]?.n
    ).toBe(8);
  } else if (state === 'player-required') {
    await expect(
      page
        .getByRole('region', { name: copy.matches.reconfirmation.title })
        .getByRole('button', { name: copy.matches.reconfirmation.reviewTerms, exact: true })
    ).toBeEnabled();
    expect(
      (
        await sql(
          `select participation_status::text from public.match_event_registrations where match_event_id='${id}' and user_id='${actor.id}'`
        )
      )[0]?.participation_status
    ).toBeNull();
  } else if (state === 'reconfirmation-excluded') {
    await expect
      .soft(page.getByText(copy.matches.reconfirmation.excluded, { exact: true }))
      .toBeVisible();
    const roster = page.getByRole('region', { name: copy.matchRegistration.aria.roster });
    // Excluded viewers need not receive private roster data: assert authoritative
    // one-quartet source group count independently, never widen roster permissions.
    expect(
      (
        await sql(
          `select count(*)::int as n from public.match_event_registrations where match_event_id='${id}' and participation_status='playing'`
        )
      )[0]?.n
    ).toBe(4);
    if (await roster.count())
      await expect(
        roster.getByRole('heading', {
          name: fill(copy.matchRegistration.roster.groupTitle, { group: 1 }),
          exact: true
        })
      ).toHaveCount(1);
  } else {
    const title =
      state === 'started-unavailable'
        ? 'started'
        : state === 'result-protected-unavailable'
          ? 'result_protected'
          : 'closed';
    await expect(
      page.getByRole('heading', { name: copy.matches.detail.statusTitles[title], exact: true })
    ).toBeVisible();
    const reason =
      state === 'started-unavailable'
        ? m.unavailable.started
        : state === 'result-protected-unavailable'
          ? m.unavailable.resultProtected
          : m.unavailable.cutoff;
    const banner = page.getByRole('region', {
      name: copy.matches.detail.statusTitles[title],
      exact: true
    });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(reason);
    if (state === 'result-protected-unavailable') {
      await expect(banner).toContainText(m.unavailable.correctionUnavailable);
      await expect(page.getByRole('link', { name: /correction|dispute/i })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toHaveCount(0);
    const leave = page.getByRole('button', { name: m.leave, exact: true });
    if (state === 'cutoff-unavailable') {
      // Retained authoritative roster may retain a disabled departure control.
      // Disabled is the approved unavailable-action pattern, not an authorization leak.
      await expect(leave).toHaveCount(1);
      await expect(leave).toBeDisabled();
    } else await expect(leave).toHaveCount(0);
  }
  const playing = await sql(
    `select count(*)::int as n from public.match_event_registrations where match_event_id='${id}' and participation_status='playing'`
  );
  const groups = Number(playing[0]!.n) / 4;
  expect(Number.isInteger(groups), 'Only complete quartets may play').toBe(true);
  const roster = page.getByRole('region', {
    name: copy.matchRegistration.aria.roster,
    includeHidden: true
  });
  if (await roster.count()) {
    for (let group = 1; group <= groups; group++) {
      await expect(
        roster.getByRole('heading', {
          name: fill(copy.matchRegistration.roster.groupTitle, { group }),
          exact: true,
          includeHidden: true
        })
      ).toHaveCount(1);
    }
    await expect(
      roster.getByRole('heading', {
        name: fill(copy.matchRegistration.roster.groupTitle, { group: groups + 1 }),
        exact: true,
        includeHidden: true
      })
    ).toHaveCount(0);
    const positions = await sql(
      `select participation_status::text as status, count(*)::int as n from public.match_event_registrations where match_event_id='${id}' and participation_status is not null group by participation_status`
    );
    for (const [status, heading] of [
      ['reserve', copy.matchRegistration.roster.reserveTitle],
      ['reserve_not_playing', copy.matchRegistration.roster.notPlayingTitle]
    ] as const) {
      const positionCount = Number(positions.find((row) => row.status === status)?.n ?? 0);
      if (positionCount > 0)
        await expect(
          roster.getByRole('heading', { name: heading, exact: true, includeHidden: true })
        ).toHaveCount(1);
    }
    if (state === 'creator-required')
      await expect(
        roster.getByRole('heading', {
          name: copy.matchRegistration.roster.awaitingTitle,
          exact: true
        })
      ).toHaveCount(1);
  }
  return page;
}

for (const [state, frame] of frames.filter(([, candidate]) =>
  [
    'YvdPB',
    'M7ighq',
    'T7T2U',
    'bobgm',
    'PKM0u',
    'K23bLC',
    'Tm3XM',
    'xgKXg',
    'iXRPp',
    'a6xmFd'
  ].includes(candidate)
)) {
  test(`${state} — approved ${frame} reference certification`, async ({ browserName }, info) => {
    expect(browserName).toBe('chromium');
    expect(
      ['all', 'changed'].includes(info.config.updateSnapshots),
      'Reference certification forbids snapshot updates'
    ).toBe(false);
    provenance();
    const approved = reference(frame);
    const size = manifest.approvedReferences[`${frame}.png`]!.sourceSize.split('x').map(Number);
    expect(size[0]).toBe(390);
    const page = await prepare(state, undefined, size[1]);
    if (frame === 'iXRPp') {
      // Approved successor adds the real record entry; never hide it to match
      // historical tVzco. Independent exact probes guard the entire composition.
      const sections = await page.locator('main > div > *').evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return [x, y, width, height];
        })
      );
      expect(sections).toEqual([
        [18, 90, 354, 44],
        [18, 144, 354, 90],
        [18, 244, 354, 280],
        [18, 534, 354, 140],
        [18, 684, 354, 476],
        [18, 1170, 354, 148],
        [18, 1328, 354, 44],
        [18, 1382, 354, 65]
      ]);
      await expect(
        page.getByRole('link', { name: defaultCopy.matches.results.title, exact: true })
      ).toBeVisible();
      const typography = await page.locator('main').evaluate((main) => {
        const read = (selector: string) => {
          const node = main.querySelector(selector);
          if (!node) throw new Error(`Missing typography probe: ${selector}`);
          const style = getComputedStyle(node);
          return [style.fontSize, style.lineHeight];
        };
        return { heading: read('h1'), entry: read('a[href$="/record"]'), share: read('textarea') };
      });
      expect(typography).toEqual({
        heading: ['24px', '26px'],
        entry: ['12px', '17px'],
        share: ['14px', '17px']
      });
      const clockBlock = page.locator('section[aria-labelledby="match-overview-heading"] > p');
      expect(
        await clockBlock.evaluate((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return [x, y, width, height];
        })
      ).toEqual([32, 424, 326, 34]);
      await expect(clockBlock).toContainText(`${defaultCopy.matches.detail.timezone}: UTC`);
    }
    await bounds(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(
        () =>
          page
            .locator('main img')
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
              )
            ),
        { message: 'Real fixture photo bytes must decode before visual capture' }
      )
      .toBe(true);
    const actualPath = info.outputPath(`${frame}-actual.png`);
    if (frame === 'PKM0u') {
      const typography = await page.locator('main').evaluate((main) => ({
        body: getComputedStyle(main).fontFamily,
        cardTitle: getComputedStyle(main.querySelector('h2')!).fontWeight,
        cardFamily: getComputedStyle(main.querySelector('h2')!).fontFamily
      }));
      expect(typography.body).toContain('Inter');
      expect(typography.cardFamily).toContain('Inter');
      expect(typography.cardTitle).toBe('600');
    }
    if (frame === 'Tm3XM') {
      const treatment = await page.getByRole('dialog').evaluate((dialog) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--color-surface)';
        probe.style.borderColor = 'var(--color-line)';
        dialog.append(probe);
        const expected = getComputedStyle(probe);
        const surface = expected.backgroundColor;
        const line = expected.borderTopColor;
        probe.remove();
        return {
          fields: [
            ...dialog.querySelectorAll('input:not([type="datetime-local"]), select, textarea')
          ].map((field) => {
            const css = getComputedStyle(field);
            return {
              flat: css.appearance === 'none' && css.boxShadow === 'none',
              surface: css.backgroundColor === surface,
              border:
                css.borderTopWidth === '1px' &&
                css.borderTopStyle === 'solid' &&
                css.borderTopColor === line,
              family: css.fontFamily
            };
          }),
          buttons: [...dialog.querySelectorAll('button')].map((button) => {
            const css = getComputedStyle(button);
            return (
              css.appearance === 'none' && css.boxShadow === 'none' && css.borderTopWidth === '0px'
            );
          })
        };
      });
      expect(treatment.fields.length).toBeGreaterThan(0);
      for (const field of treatment.fields) {
        expect(field.flat).toBe(true);
        expect(field.surface).toBe(true);
        expect(field.border).toBe(true);
        expect(field.family).toContain('Inter');
      }
      expect(treatment.buttons.every(Boolean)).toBe(true);
      const inputBounds = await page.locator('input[type="datetime-local"]').evaluateAll((inputs) =>
        inputs.map((input) => {
          const { x, y, width, height } = input.getBoundingClientRect();
          return { x, y, width, height };
        })
      );
      await info.attach('native-datetime-input-bounds', {
        body: JSON.stringify(inputBounds),
        contentType: 'application/json'
      });
      const masks = manifest.approvedReferences[`${frame}.png`]!.maskRegions ?? [];
      expect(inputBounds).toHaveLength(masks.length);
      for (const [index, input] of inputBounds.entries()) {
        const mask = masks[index]!;
        expect(input.x).toBeGreaterThanOrEqual(mask.x);
        expect(input.y).toBeGreaterThanOrEqual(mask.y);
        expect(input.x + input.width).toBeLessThanOrEqual(mask.x + mask.width);
        expect(input.y + input.height).toBeLessThanOrEqual(mask.y + mask.height);
      }
    }
    const actual = await page.screenshot({
      path: actualPath,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css'
    });
    await info.attach(`${frame}-actual`, { path: actualPath, contentType: 'image/png' });
    await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
    const measurement = await page.evaluate(
      async ({ actualUrl, approvedUrl, maskRegions, referenceScale }) => {
        async function pixels(url: string, scale = 1) {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width / scale;
          canvas.height = image.height / scale;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('No screenshot comparison canvas');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return {
            width: canvas.width,
            height: canvas.height,
            rgba: context.getImageData(0, 0, canvas.width, canvas.height).data
          };
        }
        const [a, b] = await Promise.all([pixels(actualUrl), pixels(approvedUrl, referenceScale)]);
        if (a.width !== b.width || a.height !== b.height)
          return {
            actual: [a.width, a.height],
            reference: [b.width, b.height],
            dimensionMismatch: true
          };
        for (const mask of maskRegions) {
          if (
            ![mask.x, mask.y, mask.width, mask.height].every(Number.isInteger) ||
            mask.x < 0 ||
            mask.y < 0 ||
            mask.width <= 0 ||
            mask.height <= 0 ||
            mask.x + mask.width > a.width ||
            mask.y + mask.height > a.height
          )
            throw new Error('Mask must fit both full-frame images');
          for (const image of [a, b]) {
            for (let y = mask.y; y < mask.y + mask.height; y++) {
              image.rgba.fill(
                0,
                (y * image.width + mask.x) * 4,
                (y * image.width + mask.x + mask.width) * 4
              );
            }
          }
        }
        let changed = 0;
        let perceptualChanged = 0;
        for (let yPos = 0; yPos < a.height; yPos++) {
          for (let xPos = 0; xPos < a.width; xPos++) {
            const i = (yPos * a.width + xPos) * 4;
            if (
              a.rgba[i] !== b.rgba[i] ||
              a.rgba[i + 1] !== b.rgba[i + 1] ||
              a.rgba[i + 2] !== b.rgba[i + 2] ||
              a.rgba[i + 3] !== b.rgba[i + 3]
            )
              changed++;
            const r = a.rgba[i]! - b.rgba[i]!;
            const g = a.rgba[i + 1]! - b.rgba[i + 1]!;
            const blue = a.rgba[i + 2]! - b.rgba[i + 2]!;
            const y = r * 0.29889531 + g * 0.58662247 + blue * 0.11448223;
            const chromaI = r * 0.59597799 - g * 0.2741761 - blue * 0.32180189;
            const chromaQ = r * 0.21147017 - g * 0.52261711 + blue * 0.31114694;
            // Pixelmatch's YIQ distance/0.1 threshold, without antialias exclusion.
            // Tiny background/export color noise must not count as layout drift.
            if (
              0.5053 * y * y + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
              35215 * 0.1 ** 2
            )
              perceptualChanged++;
          }
        }
        return {
          actual: [a.width, a.height],
          reference: [b.width, b.height],
          maskRegions,
          exactPixelDifference: changed / (a.width * a.height),
          perceptualPixelDifference: perceptualChanged / (a.width * a.height)
        };
      },
      {
        actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
        approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
        referenceScale: frame === 'iXRPp' ? 2 : 1,
        maskRegions: manifest.approvedReferences[`${frame}.png`]?.maskRegions ?? []
      }
    );
    // Both metrics are evidence, not authorization to absorb composition drift.
    console.info(`${frame} UNAPPROVED calibration: ${JSON.stringify(measurement)}`);
    await info.attach(`${frame}-unapproved-calibration`, {
      body: JSON.stringify(measurement, null, 2),
      contentType: 'application/json'
    });
    reference(frame); // No changed/auto-updated source accepted after capture.
    provenance();
    const budget = manifest.visualBudgets.perScreen[`${frame}.png`];
    // Reference approval and implementation certification are distinct. Null
    // budgets MUST fail until composition matches and font residuals are reviewed.
    expect(
      budget?.budget,
      `${frame}: BLOCKED — manifest has no reviewed per-screen tolerance; no self-baseline permitted`
    ).not.toBeNull();
    expect(
      budget?.baselineSha256,
      `${frame}: BLOCKED — no approved screenshot baseline digest`
    ).not.toBeNull();
    expect(budget!.budget).toBeGreaterThan(0);
    expect(hash(approved)).toBe(budget!.baselineSha256);
    // Direct comparison, not Playwright snapshot creation: even an accidental
    // --update-snapshots cannot write a reference/baseline. Budgets must be
    // reviewed for the documented YIQ 0.1 metric, screen by screcopy.
    if (
      !('perceptualPixelDifference' in measurement) ||
      measurement.perceptualPixelDifference === undefined
    ) {
      throw new Error(`${frame}: screenshot dimensions do not match the approved frame`);
    }
    expect(measurement.perceptualPixelDifference).toBeLessThanOrEqual(budget!.budget!);
    reference(frame);
  });
}

test('MatchesPage 320px longest translated header clears global chips', async () => {
  const page = await prepare('organizer-only', { width: 320, locale: 'es', theme: 'light' });
  await page.goto('/matches');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copies.es.matches.title);
  const geometry = await page.evaluate(() => {
    const controls = document.querySelector('#locale')!.parentElement!.parentElement!;
    const chips = controls.getBoundingClientRect();
    const header = document.querySelector('main > header')!;
    const copy = [...header.querySelectorAll('h1, p')]
      .map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].map((rect) => ({
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        }));
      })
      .flat();
    return {
      chips: { left: chips.left, top: chips.top, bottom: chips.bottom },
      copy,
      width: innerWidth,
      scroll: document.documentElement.scrollWidth
    };
  });
  expect(geometry.width).toBe(320);
  expect(geometry.scroll).toBeLessThanOrEqual(320);
  for (const text of geometry.copy) {
    if (text.top < geometry.chips.bottom && text.bottom > geometry.chips.top)
      expect(text.right).toBeLessThanOrEqual(geometry.chips.left);
  }
});

for (const variant of [
  { width: 320, locale: 'pt-BR' as const, theme: 'dark' as const },
  { width: 390, locale: 'en' as const, theme: 'light' as const },
  { width: 1280, locale: 'es' as const, theme: 'dark' as const }
]) {
  for (const [state] of frames) {
    test(`${state} responsive structure ${variant.width}/${variant.locale}/${variant.theme} — no variant frame`, async () => {
      const page = await prepare(state, variant);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await bounds(page, copies[variant.locale]);
    });
  }
}
