import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, leagueFixtures, sql, type Actor } from './leagues-fixtures';
import { secondCommunity } from './player-ratings-fixtures';

export { copies, day, sql, type Actor };

// Shared release world (PAF-170). Service SQL builds ONLY the initial world and the clock
// boundaries: the League anchored in the past, the registration cutoff and the event moved into
// the past. Registrations, results, reviews, ratings, standings and notifications under test go
// through the real RPCs and routes. Cleanup delegates to the League/management fixtures, which
// own deleting immutable evidence, and to the cross-community fixture for its own rows.

export const LEAGUE_START = '2026-10-01T00:00:00Z';
export const EVENT_START = '2026-10-22T16:00:00Z';
export const EVENT_CUTOFF = '2026-10-22T14:00:00Z';
export const PLAYED_GROUP_2 = '2026-10-23T19:30:00Z';
export const PLAYED_EXTRA = '2026-10-23T21:00:00Z';
const BASE_URL = 'http://127.0.0.1:4173';

export type Teams = { team_a: string[]; team_b: string[] };

export async function releaseWorld(browser: Browser) {
  const f = await leagueFixtures(browser, { memberCount: 9, communityName: 'Release Club' });
  const contexts: BrowserContext[] = [];
  const leagueId = await f.createLeague(f.creator, {
    name: 'Release League',
    endMode: 'manual',
    start: day(0),
    minimum: 1
  });
  // Time anchor: the League began on a fixed past day and every member was active then.
  await sql(`do $$ begin
    update public.leagues set start_at='${LEAGUE_START}' where id='${leagueId}';
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from='${LEAGUE_START}', activated_at='${LEAGUE_START}'
      where community_id='${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  // A League starting today may already be active; activate only through the command otherwise.
  const [league] = await sql(
    `select version, status::text as status from public.leagues where id='${leagueId}'`
  );
  if (league?.['status'] !== 'active')
    await f.rpc(f.creator, 'activate_league', {
      p_league_id: leagueId,
      p_expected_version: league?.['version']
    });
  // Unrelated League of the same community: stays Upcoming and must never change.
  const decoyLeagueId = await f.createLeague(f.creator, {
    name: 'Decoy League',
    endMode: 'fixed_date',
    start: day(1),
    end: day(2),
    minimum: 1
  });
  const cross = await secondCommunity(f.creator);
  const roles = {
    organizer: f.creator,
    /** Join order = FIFO order: organizer first, then these eight; the ninth registrant is Reserve. */
    players: f.members.slice(0, 8),
    observer: f.members[8]!,
    outsider: f.guest
  };

  /** Signed-in page in its own browser context (optionally another browser time zone). */
  async function openAs(
    who: Actor,
    options: { timezoneId?: string; locale?: 'en' | 'pt-BR' | 'es' } = {}
  ): Promise<Page> {
    const locale = options.locale ?? 'en';
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      permissions: ['local-network-access'],
      serviceWorkers: 'block',
      ...(options.timezoneId ? { timezoneId: options.timezoneId } : {})
    });
    contexts.push(context);
    await context.addCookies([
      { name: 'locale', value: locale, url: BASE_URL },
      { name: 'theme', value: 'light', url: BASE_URL }
    ]);
    const page = await context.newPage();
    await page.goto('/login');
    await waitForHydratedPage(page);
    const copy = copies[locale];
    await page.getByLabel(copy.auth.loginEmailLabel).fill(who.email);
    await page.getByLabel(copy.auth.loginPasswordLabel).fill('Password123!');
    await page.getByRole('button', { name: copy.auth.loginSubmit }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForHydratedPage(page);
    return page;
  }

  /** Real join command for each actor, sequentially, so acceptance order is the call order. */
  async function joinInOrder(eventId: string, actors: readonly Actor[]) {
    for (const actor of actors)
      await f.rpc(actor, 'submit_match_registration', { p_match_event_id: eventId });
  }

  /** Clock boundary: the event (and its registration cutoff) happened on a fixed past day. */
  async function movePast(eventId: string) {
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      alter table public.match_events disable trigger match_event_league_binding;
      update public.match_events set starts_at='${EVENT_START}', registration_cutoff_at='${EVENT_CUTOFF}'
        where id='${eventId}';
      alter table public.match_events enable trigger match_event_league_binding;
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
  }

  /** Cutoff through the production processor, then the event moves into the past. */
  async function closeRegistration(eventId: string) {
    await f.cutoff(eventId);
    await movePast(eventId);
  }

  async function roster(eventId: string, who: Actor = f.creator) {
    const rows = await f.rpc(who, 'list_match_event_registrations', { p_match_event_id: eventId });
    if (!Array.isArray(rows)) throw new Error('Expected roster rows');
    return rows.map((row: unknown) => {
      if (typeof row !== 'object' || row === null) throw new Error('Invalid roster row');
      const data = Object.fromEntries(Object.entries(row));
      return {
        name: String(data['display_name']),
        participation: String(data['participation']),
        group: typeof data['group_number'] === 'number' ? data['group_number'] : null,
        order: Number(data['accepted_order'])
      };
    });
  }

  function playedLocal(iso: string) {
    return { local: iso.slice(0, 19).replace('T', ' '), offset_seconds: 0, instant: iso };
  }

  const sets = (lines: readonly (readonly [number, number])[]) =>
    lines.map(([a, b], index) => ({
      position: index + 1,
      team_a_games: a,
      team_b_games: b,
      completed: true
    }));

  async function submitResult(
    eventId: string,
    submitter: Actor,
    groupNumber: number,
    teams: Teams,
    lines: readonly (readonly [number, number])[],
    playedAt: string
  ) {
    await f.rpc(submitter, 'submit_match_event_result', {
      p_match_event_id: eventId,
      p_group_number: groupNumber,
      p_teams: teams,
      p_sets: sets(lines),
      p_played_local: playedLocal(playedAt),
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
    return proposalId(eventId, groupNumber);
  }

  async function proposalId(eventId: string, groupNumber: number) {
    const [row] = await sql(
      `select id::text from public.match_event_result_proposals where match_event_id='${eventId}' and group_number=${groupNumber}`
    );
    return String(row?.['id']);
  }

  async function approve(reviewer: Actor, proposal: string, requestId = crypto.randomUUID()) {
    return reviewer.client.rpc('review_match_event_result', {
      p_proposal_id: proposal,
      p_expected_version: 1,
      p_decision: 'approve',
      p_request_id: requestId
    });
  }

  /** Waits for the 48h review window of a pending proposal to be over (clock boundary only). */
  async function expireWindow(proposal: string) {
    await sql(`do $$ begin
      alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
      alter table public.match_event_result_proposals disable trigger match_result_proposal_transition_guard;
      update public.match_event_result_proposal_versions
         set submitted_at=transaction_timestamp()-interval '49 hours', review_deadline_at=transaction_timestamp()-interval '1 hour'
       where proposal_id='${proposal}' and version=1;
      update public.match_event_result_proposals
         set submitted_at=transaction_timestamp()-interval '49 hours', review_deadline_at=transaction_timestamp()-interval '1 hour'
       where id='${proposal}';
      set constraints all immediate;
      alter table public.match_event_result_proposals enable trigger match_result_proposal_transition_guard;
      alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;
    end $$;`);
  }

  const ids = (actors: readonly Actor[]) => actors.map((actor) => `'${actor.id}'`).join(',');

  async function ratingEventCount(eventId: string) {
    const [row] = await sql(
      `select count(*)::int as n from public.player_rating_events where match_event_id='${eventId}'`
    );
    return Number(row?.['n']);
  }

  async function ratingStates(actors: readonly Actor[]) {
    return sql(`select user_id::text, display_level::text, reliability_percent::text,
        confirmed_competitive_game_groups::int as groups
      from public.global_player_ratings where user_id in (${ids(actors)}) order by user_id`);
  }

  async function noticeRows(kind: string, eventId: string) {
    return sql(`select id::text, recipient_user_id::text as recipient, event_key, read_at
      from public.notifications where kind='${kind}' and target_id='${eventId}'
      order by recipient_user_id, event_key`);
  }

  async function leagueCounters(forLeague = leagueId) {
    return sql(`select user_id::text, matches, wins, draws, losses, sets_won, sets_lost
      from public.league_player_counters where league_id='${forLeague}' order by user_id`);
  }

  /** Everything that must stay byte-identical for the unrelated League and community. */
  async function unrelatedSnapshot() {
    const [decoy] = await sql(`select status::text, version, jsonb_build_object(
        'counters', (select count(*) from public.league_player_counters where league_id='${decoyLeagueId}'),
        'snapshots', (select count(*) from public.league_standings_snapshots where league_id='${decoyLeagueId}'),
        'events', (select count(*) from public.match_events where league_id='${decoyLeagueId}')
      ) as facts from public.leagues where id='${decoyLeagueId}'`);
    const [other] = await sql(`select jsonb_build_object(
        'proposals', (select count(*) from public.match_event_result_proposals where match_event_id='${cross.eventId}'),
        'confirmations', (select count(*) from public.match_event_result_confirmations where match_event_id='${cross.eventId}'),
        'ratingEvents', (select count(*) from public.player_rating_events where match_event_id='${cross.eventId}'),
        'notifications', (select count(*) from public.notifications where community_id='${cross.communityId}' and kind like 'result_%'),
        'members', (select count(*) from public.community_members where community_id='${cross.communityId}')
      ) as facts`);
    return { decoy, other };
  }

  async function cleanup() {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    // The cross community needs its admin (the organizer) still alive to remove its storage rows.
    await cross.cleanup();
    await f.cleanup();
  }

  return {
    f,
    leagueId,
    decoyLeagueId,
    cross,
    ...roles,
    openAs,
    joinInOrder,
    movePast,
    closeRegistration,
    roster,
    submitResult,
    proposalId,
    approve,
    expireWindow,
    ratingEventCount,
    ratingStates,
    noticeRows,
    leagueCounters,
    unrelatedSnapshot,
    cleanup
  };
}

export type ReleaseWorld = Awaited<ReturnType<typeof releaseWorld>>;
