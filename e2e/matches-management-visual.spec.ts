import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  copies,
  en as defaultCopy,
  fill,
  fixtures,
  sql,
  visualEventId
} from './matches-management-fixtures';
import { assertFrameRegions, type FrameRegionRecord } from './frame-regions';
import clubhouse from './references/paf-202-match-management/manifest.json' with { type: 'json' };

const frames = Object.entries(clubhouse.frames);
const budgets: Record<string, { maxDiffPixelRatio: number }> = clubhouse.pixelEvidence.perFrame;
// JSON.parse keeps the manifest's literal status strings assignable to FrameRegionRecord.
const frameRegions: Record<string, Record<string, FrameRegionRecord>> = JSON.parse(
  readFileSync(
    new URL('./references/paf-202-match-management/manifest.json', import.meta.url),
    'utf8'
  )
).frameRegions;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let f: Awaited<ReturnType<typeof fixtures>>;
test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', serviceWorkers: 'block' });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  expect(hash(readFileSync(clubhouse.sourceDesign.path))).toBe(clubhouse.sourceDesign.sha256);
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
        // A native radio is operated through its label, which carries the 44px target.
        const target =
          element instanceof HTMLInputElement && element.type === 'radio'
            ? (element.closest('label') ?? element)
            : element;
        const rect = target.getBoundingClientRect();
        return {
          label:
            element.getAttribute('aria-label') ?? target.textContent?.trim() ?? element.tagName,
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
    // lJHUZ / t0SZec are page flows: the edit replaces the detail inside main, with pinned actions.
    const dialog = page.locator('main');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      dialog.getByRole('heading', { level: 1, name: m.edit.title, exact: true })
    ).toBeFocused();
    const save = dialog.getByRole('button', { name: m.edit.save, exact: true });
    expect(await save.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe(
      'sticky'
    );
    await expect(save).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(save).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (state === 'major-change')
      await dialog
        .getByRole('combobox', { name: copy.matchCreate.fields.type, exact: true })
        .selectOption('competitive');
    else
      await dialog.getByLabel(copy.matchCreate.fields.venueName, { exact: true }).fill('Court 4');
    const review = dialog.getByRole('region', { name: m.edit.reviewMajor });
    if (state === 'major-change') await expect(review).toBeVisible();
    else await expect(review).toHaveCount(0);
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
        // Competitive drafts add the Ranked/Unranked status radios (PAF-11).
        ...(state === 'major-change'
          ? [copy.matches.competition.ranked, copy.matches.competition.unranked]
          : []),
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
      await page.evaluate(() => window.scrollTo(0, 0));
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
  } else if (state === 'organizer-participation') {
    // m7hh3 (remapped): the organizer leaving the roster is the live withdraw choice.
    await page.getByRole('button', { name: m.leave, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(m.leaveTitle);
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
    await expect(dialog).toHaveAccessibleName(state === 'cancel' ? m.cancelTitle : m.transferTitle);
    const actions = dialog.getByRole('button');
    const actionHeights = await actions.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(actionHeights).toHaveLength(2);
    expect(actionHeights.every((actionHeight) => actionHeight >= 52)).toBe(true);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: m.actions, exact: true })).toBeFocused();
    await page.getByRole('button', { name: m.actions, exact: true }).click();
    await page
      .getByRole('menuitem', { name: state === 'cancel' ? m.cancelMatch : m.transfer, exact: true })
      .click();
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
    expect(await page.getByRole('menuitem').allTextContents()).toEqual([
      m.transfer,
      copy.matches.addPlayer.action,
      m.cancelMatch
    ]);
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
    if (state === 'started-unavailable')
      await expect(
        page.getByRole('link', { name: copy.matches.results.title, exact: true })
      ).toBeVisible();
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

/** Live regions compared with the same region of the Pencil export (manifest.frameRegions). */
function frameRegionLocators(
  page: Page,
  state: string,
  copy: typeof defaultCopy
): Record<string, Locator> | null {
  const m = copy.matches.management;
  const dialog = page.getByRole('dialog');
  const reconfirmation = page.getByRole('region', { name: copy.matches.reconfirmation.title });
  const invitations = page.getByRole('region', { name: copy.matches.invitations.title });
  const save = page.getByRole('button', { name: m.edit.save, exact: true });
  const reviewDraft = page.getByRole('button', { name: m.edit.reviewDraft, exact: true });
  const statusRegion = (title: keyof typeof copy.matches.detail.statusTitles) =>
    page.getByRole('region', { name: copy.matches.detail.statusTitles[title], exact: true });
  switch (state) {
    case 'minor-edit':
    case 'major-change':
      return { saveAction: save, saveActionFill: save };
    case 'minor-edit-conflict':
      return {
        conflictAlert: page.getByRole('main').getByRole('alert'),
        reviewDraftAction: reviewDraft,
        reviewDraftFill: reviewDraft,
        reloadAction: page.getByRole('button', { name: m.edit.reload, exact: true }),
        pinnedFooter: save.locator('..')
      };
    case 'invitation-pending':
      return {
        statusNotice: invitations.getByRole('status'),
        acceptAction: invitations.getByRole('button', {
          name: copy.matches.invitations.accept,
          exact: true
        }),
        declineAction: invitations.getByRole('button', {
          name: copy.matches.invitations.decline,
          exact: true
        })
      };
    case 'invitation-accepted':
      return { statusBanner: statusRegion('accepted') };
    case 'invitation-declined':
      return { statusBanner: statusRegion('declined') };
    case 'invitation-expired':
      return { statusBanner: statusRegion('expired') };
    case 'creator-action-menu':
      return { menu: page.getByRole('menu') };
    case 'organizer-only':
      return {
        organizerNotice: page.getByText(m.organizerOnly, { exact: true }),
        manageAction: page.getByRole('button', { name: m.actions, exact: true })
      };
    case 'cancelled-tombstone':
      return { cancelledBanner: statusRegion('cancelled') };
    case 'started-unavailable':
      return {
        lockedBanner: statusRegion('started'),
        recordResultAction: page.getByRole('link', {
          name: copy.matches.results.title,
          exact: true
        })
      };
    case 'result-protected-unavailable':
      return { protectedBanner: statusRegion('result_protected') };
    case 'creator-required':
      return {
        reconfirmPanel: reconfirmation,
        awaitingEntry: reconfirmation.getByRole('listitem')
      };
    case 'player-required':
      return {
        reconfirmAction: page
          .getByRole('region', { name: copy.matches.reconfirmation.title })
          .getByRole('button', { name: copy.matches.reconfirmation.reviewTerms, exact: true })
      };
    case 'reconfirmation-excluded':
      return {
        excludedNotice: page.getByText(copy.matches.reconfirmation.excluded, { exact: true })
      };
    case 'removal-reason-dialog':
    case 'cancel':
      return {
        dialog,
        confirmAction: dialog.getByRole('button').first(),
        dismissAction: dialog.getByRole('button').last()
      };
    case 'organizer-participation':
      return { dialog, dialogSurface: dialog };
    case 'cutoff-unavailable':
      return {
        closedBanner: page.getByRole('region', {
          name: copy.matches.detail.statusTitles.closed,
          exact: true
        })
      };
    default:
      return null;
  }
}

// Clubhouse PNGs pin design provenance. Chromium snapshots cover the real fixtures.
test('Clubhouse design exports match pinned digests', () => {
  for (const [frame, sha256] of Object.entries(clubhouse.exportSha256)) {
    const bytes = readFileSync(
      new URL(`./references/paf-202-match-management/${frame}.png`, import.meta.url)
    );
    expect(hash(bytes), frame).toBe(sha256);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], frame).toEqual([390, 844]);
  }
});

for (const [state, frame] of frames) {
  test(`${state} — Clubhouse ${frame} reference and browser regression`, async () => {
    const page = await prepare(state);
    await bounds(page);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page
          .locator('main img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
            )
          )
      )
      .toBe(true);
    const capture = { animations: 'disabled', caret: 'hide', scale: 'css' } as const;
    const regions = frameRegions[frame];
    const locators = frameRegionLocators(page, state, defaultCopy);
    // Design layer first: the Pencil export is the reference, the Chromium snapshot only guards
    // browser regressions. A mapped state without manifest regions must not skip the comparison.
    if (locators) {
      if (!regions) throw new Error(`Missing frame regions: ${state} ${frame}`);
      // F25: management panels follow the hero and roster, so a panel below the first screen is
      // scrolled into view (centered, clear of the sticky action bar) before it is cropped.
      for (const locator of Object.values(locators))
        await locator.first().evaluate((node) => {
          const box = node.getBoundingClientRect();
          if (box.bottom > innerHeight || box.top < 0) node.scrollIntoView({ block: 'center' });
        });
      await assertFrameRegions({
        page,
        frame,
        reference: readFileSync(
          new URL(`./references/paf-202-match-management/${frame}.png`, import.meta.url)
        ),
        regions,
        locators
      });
    }
    const budget = budgets[frame];
    if (!budget) throw new Error(`Missing Clubhouse browser budget: ${frame}`);
    await expect(page).toHaveScreenshot(`${frame}-light.png`, {
      ...capture,
      maxDiffPixelRatio: budget.maxDiffPixelRatio
    });
    if (test.info().config.updateSnapshots === 'missing') {
      // Initial baseline capture: prove working-copy stability after screenshot settling.
      const snapshots = await page.screenshot(capture);
      const repeat = await page.screenshot(capture);
      expect(hash(snapshots), `${frame}: consecutive Chromium captures`).toBe(hash(repeat));
    }
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

// The Transfer organization dialog has no dedicated frame (manifest.unframedStates): structural
// probes in prepare() plus a Chromium regression baseline, never a design-frame comparison.
test('transfer — no dedicated frame, browser regression', async () => {
  const page = await prepare('transfer');
  await bounds(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('transfer-light.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    maxDiffPixelRatio: clubhouse.unframedStates.transfer.maxDiffPixelRatio
  });
});

for (const variant of [
  { width: 320, locale: 'pt-BR' as const, theme: 'dark' as const },
  { width: 390, locale: 'en' as const, theme: 'light' as const },
  { width: 1280, locale: 'es' as const, theme: 'dark' as const }
]) {
  for (const [state, frame] of [...frames, ['transfer', 'unframed'] as const]) {
    test(`${state} (${frame}) responsive structure ${variant.width}/${variant.locale}/${variant.theme} — no variant frame`, async () => {
      const page = await prepare(state, variant);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await bounds(page, copies[variant.locale]);
    });
  }
}
