import { expect, type Browser, type Page } from '@playwright/test';
import { fixtures, copies, fill, sql } from './matches-management-fixtures';
import { waitForHydratedPage } from './auth-helpers';

export { copies, fill, sql };
export type { Actor } from './matches-management-fixtures';
export type Locale = keyof typeof copies;

export async function resultFixtures(browser: Browser, options?: Parameters<typeof fixtures>[1]) {
  const f = await fixtures(browser, options);
  return {
    ...f,
    async completedEvent(type: 'competitive' | 'friendly' = 'competitive', players = 8) {
      const id = await f.event(players);
      await f.cutoff(id);
      await sql(`do $$ begin
        alter table public.match_events disable trigger match_event_immutable;
      end $$;`);
      try {
        await sql(`update public.match_events
          set starts_at='2026-10-01T22:00:00Z', registration_cutoff_at='2026-10-01T20:00:00Z', event_type='${type}'
          where id='${id}'`);
      } finally {
        await sql(`do $$ begin
          alter table public.match_events enable trigger match_event_immutable;
        end $$;`);
      }
      return id;
    },
    async expireProposal(proposalId: string) {
      await sql(`do $$ begin
        alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
        alter table public.match_event_result_proposals disable trigger match_result_proposal_transition_guard;
      end $$;`);
      try {
        await sql(`do $$ begin
          update public.match_event_result_proposal_versions
             set submitted_at=transaction_timestamp()-interval '49 hours',
                 review_deadline_at=transaction_timestamp()-interval '1 hour'
           where proposal_id='${proposalId}';
          update public.match_event_result_proposals
             set submitted_at=transaction_timestamp()-interval '49 hours',
                 review_deadline_at=transaction_timestamp()-interval '1 hour'
           where id='${proposalId}';
          set constraints all immediate;
        end $$;`);
      } finally {
        await sql(`do $$ begin
          alter table public.match_event_result_proposals enable trigger match_result_proposal_transition_guard;
          alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;
        end $$;`);
      }
    },
    async cleanup() {
      await f.cleanup();
    }
  };
}

export async function openRecord(page: Page, id: string) {
  await page.goto(`/matches/${id}/record`);
  await waitForHydratedPage(page);
}

export async function correctTeams(page: Page, locale: Locale = 'en') {
  const r = copies[locale].matches.results;
  await page.getByRole('button', { name: r.changeTeams, exact: true }).click();
  const slots = page.locator('form select');
  await expect(slots).toHaveCount(4);
  const ids = await slots
    .first()
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => {
        if (!(option instanceof HTMLOptionElement)) throw new Error('Expected option');
        return option.value;
      })
    );
  await slots.nth(1).selectOption(ids[2]!);
  const actual = await slots.evaluateAll((selects) =>
    selects.map((select) => {
      if (!(select instanceof HTMLSelectElement)) throw new Error('Expected select');
      return select.value;
    })
  );
  expect(actual).toEqual([ids[0], ids[2], ids[1], ids[3]]);
  return { team_a: actual.slice(0, 2), team_b: actual.slice(2) };
}

export async function enterScore(
  page: Page,
  scores: [number, number, boolean][] = [
    [6, 4, true],
    [4, 6, true],
    [2, 1, false]
  ],
  locale: Locale = 'en'
) {
  const r = copies[locale].matches.results;
  await page.getByRole('button', { name: r.confirmTeams, exact: true }).click();
  for (const [index, [a, b, complete]] of scores.entries()) {
    if (index) await page.getByRole('button', { name: r.addSet }).click();
    const row = page.getByRole('group', {
      name: fill(r.setNumber, { number: index + 1 }),
      exact: true
    });
    await row.getByRole('textbox', { name: r.teams.team_a, exact: true }).fill(String(a));
    await row.getByRole('textbox', { name: r.teams.team_b, exact: true }).fill(String(b));
    await row.getByRole('textbox', { name: r.teams.team_b, exact: true }).blur();
    if (complete)
      await row.getByRole('button', { name: fill(r.setStateLabel, { number: index + 1 }) }).click();
  }
  await page
    .getByLabel(fill(r.playedAt, { timezone: 'UTC' }), { exact: true })
    .fill('2026-10-23T18:30');
  await page.getByLabel(fill(r.playedAt, { timezone: 'UTC' }), { exact: true }).blur();
  await page.getByLabel(r.courtLabel, { exact: true }).fill('Court 2');
}

export async function review(page: Page, locale: Locale = 'en') {
  const r = copies[locale].matches.results;
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByRole('heading', { name: r.preview, exact: true })).toBeVisible();
}

export async function officialSnapshot(community: string) {
  // Entire rows, not only rating values: catches reliability/statistics side effects.
  return sql(`select * from (select 'profiles' as kind, to_jsonb(p) as facts from public.player_profiles p where p.user_id in (select user_id from public.community_members where community_id='${community}')
    union all select 'ratings', to_jsonb(r) from public.global_player_ratings r where r.user_id in (select user_id from public.community_members where community_id='${community}')) snapshots order by kind, facts::text`);
}
