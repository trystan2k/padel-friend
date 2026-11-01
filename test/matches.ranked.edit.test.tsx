/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import type { MatchLeagueOption } from '../src/features/matches/match-contracts';
import { makeMatchDetail, makeMatchLeagueOption } from './helpers/match-fixtures';

const mocks = vi.hoisted(() => ({
  edit: vi.fn<(arg: { data: { patch: Record<string, unknown> } }) => Promise<unknown>>(),
  leagues: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => void>()
}));
vi.mock('../src/features/matches/match-management.functions', () => ({
  editMatchEvent: mocks.edit
}));
vi.mock('../src/features/matches/matches.functions', () => ({
  getMatchLeagueOptions: mocks.leagues
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchEditDialog } from '../src/features/matches/MatchEditDialog';

const eventId = '11111111-1111-4111-8111-111111111111';
const springId = '44444444-4444-4444-8444-444444444444';
const summerId = '55555555-5555-4555-8555-555555555555';
const spring = makeMatchLeagueOption({
  id: springId,
  name: 'Spring League',
  start_date: '2099-01-01',
  end_date: '2099-03-01'
});
const summer = makeMatchLeagueOption({
  id: summerId,
  name: 'Summer League',
  status: 'upcoming',
  start_date: '2098-12-01',
  end_date: '2099-04-01'
});
const base = {
  event_id: eventId,
  event_type: 'competitive' as const,
  venue_name: 'Original court',
  maps_url: 'https://maps.google.com/maps/court',
  starts_at: '2099-01-15T12:00:00Z',
  registration_cutoff_at: '2099-01-15T10:00:00Z',
  timezone: 'UTC',
  price_minor: null,
  currency: null,
  accepted_count: 3
};
const unrankedEvent = makeMatchDetail({ ...base, competition_status: 'unranked', league_id: null });
const rankedEvent = makeMatchDetail({
  ...base,
  competition_status: 'ranked',
  league_id: springId,
  league_name: 'Spring League',
  league_start_date: '2099-01-01',
  league_end_date: '2099-03-01'
});

function element(event = unrankedEvent, locale: Locale = 'en') {
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchEditDialog
        event={event}
        version={4}
        onClose={mocks.close}
        returnFocus={{ current: null }}
      />
    </I18nextProvider>
  );
}
const ok = (changeKind: 'major' | 'minor' = 'major', carried = 0) => ({
  status: 'ok',
  replayed: false,
  value: {
    event_id: eventId,
    request_id: eventId,
    version: 5,
    transition_revision: 5,
    changed: true,
    change_kind: changeKind,
    changed_fields: ['league_id'],
    reconfirmation_generation: 1,
    carried_count: carried
  }
});
const offer = (...leagues: MatchLeagueOption[]) =>
  mocks.leagues.mockResolvedValue({ starts_at: '2099-01-15T12:00:00.000Z', leagues });
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
const lastPatch = () => mocks.edit.mock.calls.at(-1)?.[0].data.patch;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue();
});
afterEach(cleanup);

describe('Ranked/League edit dialog', () => {
  it('requests eligible Leagues for the edited schedule and switches Unranked to Ranked with visible impact', async () => {
    offer(spring);
    render(element());
    const ranked = await screen.findByRole<HTMLInputElement>('radio', { name: 'Ranked' });
    await waitFor(() => expect(ranked.disabled).toBe(false));
    expect(mocks.leagues).toHaveBeenCalledWith({
      data: { community_id: unrankedEvent.community_id, date: '2099-01-15', start_time: '12:00:00' }
    });
    // Nothing changes until the organizer chooses: no impact panel, no consent warning.
    expect(screen.queryByText('Ranking impact')).toBeNull();
    await userEvent.click(ranked);
    const impact = screen.getByRole('region', { name: 'Ranking impact' });
    expect(impact.textContent).toContain('Unranked');
    expect(impact.textContent).toContain('Ranked · Spring League');
    expect(impact.textContent).toContain(
      'This match will count for the League once players reconfirm.'
    );
    expect(impact.textContent).toContain('Unranked Competitive matches still update it');
    expect(
      screen.getByText(
        'Accepted players must reconfirm this change. Provisional players carry over automatically.'
      )
    ).toBeTruthy();
    mocks.edit.mockResolvedValue(ok());
    await save();
    await screen.findByText('Match details saved.');
    expect(mocks.edit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_version: 4,
        patch: expect.objectContaining({ league_id: springId })
      })
    });
  });

  it('explicit League-ID switch shows both Leagues and sends the chosen id', async () => {
    offer(spring, summer);
    render(element(rankedEvent));
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'League' });
    expect(select.value).toBe(springId);
    await userEvent.selectOptions(select, summerId);
    const impact = screen.getByRole('region', { name: 'Ranking impact' });
    expect(impact.textContent).toContain('Ranked · Spring League');
    expect(impact.textContent).toContain('Ranked · Summer League');
    expect(impact.textContent).toContain('This match will count for a different League.');
    mocks.edit.mockResolvedValue(ok());
    await save();
    await waitFor(() => expect(lastPatch()?.league_id).toBe(summerId));
  });

  it('an unrelated edit keeps the League and never downgrades silently', async () => {
    offer(spring);
    render(element(rankedEvent));
    await screen.findByRole('combobox', { name: 'League' });
    mocks.edit.mockResolvedValue(ok());
    // Unrelated edit keeps the League (null is never sent by default).
    await userEvent.clear(screen.getByRole('textbox', { name: 'Venue name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Venue name' }), 'New court');
    await save();
    await waitFor(() => expect(lastPatch()?.league_id).toBe(springId));
  });

  it('Unranked choice sends league_id null and explains that the match stops counting for the League', async () => {
    offer(spring);
    render(element(rankedEvent));
    await screen.findByRole('combobox', { name: 'League' });
    await userEvent.click(screen.getByRole('radio', { name: 'Unranked' }));
    expect(screen.getByText('This match will stop counting for the League.')).toBeTruthy();
    mocks.edit.mockResolvedValue(ok());
    await save();
    await waitFor(() => expect(lastPatch()?.league_id).toBeNull());
  });

  it('keeps the bound League selectable when the options reader no longer lists it', async () => {
    offer();
    render(element(rankedEvent));
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'League' });
    expect(select.value).toBe(springId);
    mocks.edit.mockResolvedValue(ok('minor'));
    await save();
    await waitFor(() => expect(lastPatch()?.league_id).toBe(springId));
  });

  it('several eligible Leagues require an explicit choice before Ranked can be saved', async () => {
    offer(spring, summer);
    render(element());
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Ranked' }).disabled).toBe(false)
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Ranked' }));
    await save();
    expect(
      await screen.findByText('Choose a League or select Unranked before publishing.')
    ).toBeTruthy();
    expect(mocks.edit).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'League' }), summerId);
    mocks.edit.mockResolvedValue(ok());
    await save();
    await waitFor(() => expect(lastPatch()?.league_id).toBe(summerId));
  });

  it('outside-period rejection shows League window and both explicit repair choices', async () => {
    offer(spring);
    render(element(rankedEvent));
    await screen.findByRole('combobox', { name: 'League' });
    const start = screen.getByLabelText('Start date and time');
    await userEvent.clear(start);
    await userEvent.type(start, '2099-06-01T12:00');
    mocks.edit.mockResolvedValue({
      status: 'error',
      code: 'league_out_of_period',
      detail: {
        league: {
          competition_status: 'ranked',
          league_id: springId,
          league_name: 'Spring League',
          league_start_at: '2099-01-01T00:00:00.000Z',
          league_end_at: '2099-03-01T00:00:00.000Z',
          league_timezone: 'UTC'
        }
      }
    });
    await save();
    const alert = await screen.findByText('The new date is outside the League period');
    const panel = alert.closest('section');
    expect(panel?.textContent).toContain('Spring League runs');
    expect(panel?.textContent).toContain('Nothing was saved and the League was not changed.');
    expect(mocks.edit).toHaveBeenCalledOnce();
    // Repair 1: pick another date.
    await userEvent.click(screen.getByRole('button', { name: 'Choose another date' }));
    expect(document.activeElement).toBe(start);
    // Repair 2: explicit Unranked with the new date, one atomic request.
    mocks.edit.mockResolvedValue(ok());
    await userEvent.click(
      screen.getByRole('button', { name: 'Save as Unranked with the new date' })
    );
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    expect(lastPatch()).toMatchObject({ league_id: null, starts_at: '2099-06-01T12:00:00.000Z' });
    expect(await screen.findByText('Match details saved.')).toBeTruthy();
  });

  it('accepted-nonmember rejection explains the count and offers to keep the match Unranked', async () => {
    offer(spring);
    render(element());
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Ranked' }).disabled).toBe(false)
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Ranked' }));
    mocks.edit.mockResolvedValue({
      status: 'error',
      code: 'ranked_nonmembers_accepted',
      detail: { accepted_nonmember_count: 2 }
    });
    await save();
    expect(await screen.findByText('Resolve non-member players first')).toBeTruthy();
    expect(screen.getByText(/2 accepted players are not active community members/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it Unranked' }));
    expect(screen.queryByText('Resolve non-member players first')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Unranked' }).checked).toBe(true);
  });

  it('Friendly never sends a League and hides the competition control', async () => {
    offer(spring);
    render(element(rankedEvent));
    await screen.findByRole('combobox', { name: 'League' });
    await userEvent.selectOptions(screen.getByLabelText('Match type'), 'friendly');
    expect(screen.queryByRole('radio', { name: 'Ranked' })).toBeNull();
    expect(
      screen.getByText('This match will no longer be Competitive, so it has no League.')
    ).toBeTruthy();
    mocks.edit.mockResolvedValue(ok());
    await save();
    await waitFor(() =>
      expect(lastPatch()).toMatchObject({ event_type: 'friendly', league_id: null })
    );
  });

  it('ignores a slow League response for an earlier schedule (generation guard)', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mocks.leagues
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue({ starts_at: '2099-02-01T12:00:00.000Z', leagues: [summer] });
    render(element());
    await waitFor(() => expect(mocks.leagues).toHaveBeenCalledTimes(1));
    const start = await screen.findByLabelText('Start date and time');
    await userEvent.clear(start);
    await userEvent.type(start, '2099-02-01T12:00');
    await waitFor(() => expect(mocks.leagues).toHaveBeenCalledTimes(2));
    resolveFirst({ starts_at: '2099-01-15T12:00:00.000Z', leagues: [spring] });
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Ranked' }).disabled).toBe(false)
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Ranked' }));
    // Only the current schedule's League is offered; the stale one never leaks in.
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options.some((text) => text?.includes('Summer League'))).toBe(true);
    expect(options.some((text) => text?.includes('Spring League'))).toBe(false);
  });

  it('tells the organizer provisional players were carried over after the save', async () => {
    offer(spring);
    render(element());
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Ranked' }).disabled).toBe(false)
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Ranked' }));
    mocks.edit.mockResolvedValue(ok('major', 1));
    await save();
    expect(
      await screen.findByText(
        'Match details saved. Provisional players were carried over automatically because they cannot reconfirm.'
      )
    ).toBeTruthy();
  });

  it.each(['pt-BR', 'es'] as const)('renders translated competition copy: %s', async (locale) => {
    const i18n = createI18n(locale);
    offer(spring);
    render(element(rankedEvent, locale));
    await screen.findByRole('combobox', { name: i18n.t('matchCreate.competition.league') });
    await userEvent.click(
      screen.getByRole('radio', { name: i18n.t('matches.competition.unranked') })
    );
    const impact = screen.getByRole('region', { name: i18n.t('matches.leagueImpact.title') });
    expect(impact.textContent).toContain(i18n.t('matches.leagueImpact.effect.rankedToUnranked'));
    expect(impact.textContent).toContain(i18n.t('matches.leagueImpact.skillIndependent'));
    expect(screen.getByText(i18n.t('matches.management.edit.competitionConsent'))).toBeTruthy();
    expect(i18n.t('matches.management.edit.rejection.league_out_of_period.title')).not.toContain(
      'rejection'
    );
  });
});
