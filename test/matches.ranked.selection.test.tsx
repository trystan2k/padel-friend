/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { MatchLeagueOption } from '../src/features/matches/match-contracts';
import en from '../src/locales/en/translation.json';

const mocks = vi.hoisted(() => ({
  options: vi.fn<(...args: any[]) => Promise<any>>(),
  leagues: vi.fn<(...args: any[]) => Promise<any>>(),
  search: vi.fn<(...args: any[]) => Promise<any>>(),
  publish: vi.fn<(...args: any[]) => Promise<{ event_id: string }>>(),
  upload: vi.fn<(...args: any[]) => Promise<string>>(),
  copy: vi.fn<(...args: any[]) => Promise<string>>(),
  remove: vi.fn<(...args: any[]) => Promise<void>>(),
  sign: vi.fn<(...args: any[]) => Promise<string>>(),
  navigate: vi.fn<(...args: any[]) => Promise<void>>(),
  browserClient: vi.fn<(...args: any[]) => any>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate
}));
vi.mock('../src/features/matches/matches.functions', () => ({
  getMatchCreationOptions: mocks.options,
  getMatchLeagueOptions: mocks.leagues,
  searchMatchInvitees: mocks.search,
  publishMatchEvent: mocks.publish
}));
vi.mock('../src/features/matches/match-photo.functions', () => ({
  copySavedVenueMatchPhotoFn: mocks.copy,
  finalizeMatchPhotoUploadFn: mocks.upload,
  removeUnpublishedMatchPhotoFn: mocks.remove,
  signUnattachedMatchPhotoFn: mocks.sign
}));
vi.mock('../src/lib/supabase/client', () => ({ getBrowserClient: mocks.browserClient }));
import { CreateMatchPage } from '../src/features/matches/CreateMatchPage';
import { makeMatchCreationOptions, makeMatchLeagueOption } from './helpers/match-fixtures';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const springId = '44444444-4444-4444-8444-444444444444';
const summerId = '55555555-5555-4555-8555-555555555555';
const spring = makeMatchLeagueOption({ id: springId, name: 'Spring League' });
const summer = makeMatchLeagueOption({
  id: summerId,
  name: 'Summer League',
  status: 'upcoming',
  start_date: '2030-05-15',
  end_date: '2030-08-31'
});
const pngFixture = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'x.png', {
    type: 'image/png'
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const leagueResult = (leagues: MatchLeagueOption[]) => ({
  starts_at: '2030-05-20T16:30:00.000000Z',
  leagues
});
function control<T extends HTMLElement>(element: HTMLElement, type: new () => T): T {
  if (!(element instanceof type)) throw new TypeError('Unexpected control type');
  return element;
}
const radio = (name: string) => control(screen.getByRole('radio', { name }), HTMLInputElement);
const leagueSelect = () =>
  control(screen.getByLabelText(en.matchCreate.competition.league), HTMLSelectElement);

async function mount() {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <CreateMatchPage />
    </I18nextProvider>
  );
  await screen.findByRole('combobox', { name: /community/i });
}
async function makeCompetitive(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(en.matchCreate.fields.type), 'competitive');
  await user.type(screen.getByLabelText(en.matchCreate.fields.date), '2030-05-20');
  await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '18:30');
}
async function readyToPublish(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en.matchCreate.fields.venueName), 'Court Central');
  await user.type(
    screen.getByLabelText(en.matchCreate.fields.mapsUrl),
    'https://www.google.com/maps/place/Central'
  );
  await user.upload(screen.getByLabelText(en.matchCreate.fields.photo), pngFixture());
  await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
  await screen.findByRole('img', { name: en.matchCreate.fields.photo });
}
async function toReview(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 3; i++)
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
}
const publishInput = (call = 0) => {
  const input: Record<string, unknown> = mocks.publish.mock.calls[call]?.[0].data.input;
  return input;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockResolvedValue(
    makeMatchCreationOptions({
      communities: [
        { id: idA, name: 'Club A', timezone: 'Europe/Madrid', currency: 'EUR' },
        { id: idB, name: 'Club B', timezone: 'Europe/Madrid', currency: 'EUR' }
      ]
    })
  );
  mocks.leagues.mockResolvedValue(leagueResult([]));
  mocks.search.mockResolvedValue([]);
  mocks.publish.mockResolvedValue({ event_id: 'match-id' });
  mocks.upload.mockResolvedValue('staged/photo.png');
  mocks.copy.mockResolvedValue('staged/saved-venue.png');
  mocks.remove.mockResolvedValue(undefined);
  mocks.sign.mockResolvedValue('https://signed.test/photo');
  mocks.navigate.mockResolvedValue(undefined);
  mocks.browserClient.mockReturnValue({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'x' } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ranked League selection in the create-match wizard', () => {
  it('keeps Friendly drafts free of competition controls and payload keys', async () => {
    const user = userEvent.setup();
    await mount();
    expect(screen.queryByText(en.matchCreate.competition.legend)).toBeNull();
    await user.type(screen.getByLabelText(en.matchCreate.fields.date), '2030-05-20');
    await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '18:30');
    expect(mocks.leagues).not.toHaveBeenCalled();
  });

  it('defaults to Unranked with explanatory guidance when no League covers the schedule', async () => {
    const user = userEvent.setup();
    await mount();
    await makeCompetitive(user);
    await screen.findByText(new RegExp(en.matchCreate.competition.guidance.noEligible));
    expect(radio(en.matches.competition.unranked).checked).toBe(true);
    expect(radio(en.matches.competition.ranked).disabled).toBe(true);
    expect(mocks.leagues).toHaveBeenLastCalledWith({
      data: { community_id: idA, date: '2030-05-20', start_time: '18:30' }
    });
    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(publishInput()).toMatchObject({ competition: 'unranked', league_id: null });
  });

  it('defaults to Ranked with the single eligible League displayed and saved explicitly', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockResolvedValue(leagueResult([spring]));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(radio(en.matches.competition.ranked).checked).toBe(true));
    expect(leagueSelect().value).toBe(springId);
    await readyToPublish(user);
    await toReview(user);
    expect(screen.getByText(/Ranked · Spring League/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(publishInput()).toMatchObject({ competition: 'ranked', league_id: springId });
  });

  it('blocks publication while several Leagues need an explicit choice, then saves the picked ID', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockResolvedValue(leagueResult([spring, summer]));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(radio(en.matches.competition.ranked).checked).toBe(true));
    expect(leagueSelect().value).toBe('');
    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    // Validation sends the user back to the selector with an announced, associated error.
    const alert = await screen.findByText(en.matchCreate.errors.leagueRequired);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(leagueSelect().getAttribute('aria-invalid')).toBe('true');
    expect(leagueSelect().getAttribute('aria-describedby')).toBe(alert.id);

    await user.selectOptions(leagueSelect(), summerId);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(publishInput()).toMatchObject({ competition: 'ranked', league_id: summerId });
  });

  it('keeps an explicit League pick from being replaced when only another League stays eligible', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockResolvedValue(leagueResult([spring, summer]));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(leagueSelect().value).toBe(''));
    await user.selectOptions(leagueSelect(), summerId);
    expect(leagueSelect().value).toBe(summerId);

    // The new schedule leaves only Spring eligible: it must not be bound silently.
    mocks.leagues.mockResolvedValue(leagueResult([spring]));
    await user.clear(screen.getByLabelText(en.matchCreate.fields.startTime));
    await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '19:00');
    await waitFor(() => expect(leagueSelect().value).toBe(''));
    expect(radio(en.matches.competition.ranked).checked).toBe(true);
    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await screen.findByText(en.matchCreate.errors.leagueRequired);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('never resets a deliberate Unranked choice across schedule, type and option reloads', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockResolvedValue(leagueResult([spring]));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(radio(en.matches.competition.ranked).checked).toBe(true));
    await user.click(radio(en.matches.competition.unranked));
    expect(radio(en.matches.competition.unranked).checked).toBe(true);

    // Schedule change reloads the candidates; the opt-out stays.
    await user.clear(screen.getByLabelText(en.matchCreate.fields.startTime));
    await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '19:00');
    await waitFor(() => expect(mocks.leagues).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(radio(en.matches.competition.unranked).checked).toBe(true));

    // Friendly and back to Competitive keeps it as well.
    await user.selectOptions(screen.getByLabelText(en.matchCreate.fields.type), 'friendly');
    await user.selectOptions(screen.getByLabelText(en.matchCreate.fields.type), 'competitive');
    await waitFor(() => expect(radio(en.matches.competition.unranked).checked).toBe(true));

    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(publishInput()).toMatchObject({ competition: 'unranked', league_id: null });
  });

  it('ignores a stale League response for a previous schedule', async () => {
    const user = userEvent.setup();
    const slow = deferred<ReturnType<typeof leagueResult>>();
    mocks.leagues.mockReturnValueOnce(slow.promise).mockResolvedValue(leagueResult([summer]));
    await mount();
    await user.selectOptions(screen.getByLabelText(en.matchCreate.fields.type), 'competitive');
    await user.type(screen.getByLabelText(en.matchCreate.fields.date), '2030-05-20');
    await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '18:30');
    // The first (slow) request is for 18:3; a later keystroke superseded it.
    slow.resolve(leagueResult([spring]));
    await waitFor(() => expect(leagueSelect().value).toBe(summerId));
    expect(screen.queryByRole('option', { name: /Spring League/ })).toBeNull();
  });

  it('ignores a League response for the previous community after switching', async () => {
    const user = userEvent.setup();
    const slow = deferred<ReturnType<typeof leagueResult>>();
    mocks.leagues.mockReturnValueOnce(slow.promise).mockResolvedValue(leagueResult([]));
    await mount();
    await makeCompetitive(user);
    await user.selectOptions(screen.getByLabelText(en.matchCreate.fields.community), idB);
    slow.resolve(leagueResult([spring]));
    await screen.findByRole('combobox', { name: en.matchCreate.fields.community });
    expect(screen.queryByRole('option', { name: /Spring League/ })).toBeNull();
    expect(screen.queryByLabelText(en.matchCreate.competition.league)).toBeNull();
  });

  it('shows a retryable error and blocks publish while League options cannot load', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockRejectedValue(new Error('MATCH_LEAGUE_OPTIONS_UNAVAILABLE'));
    await mount();
    await makeCompetitive(user);
    await screen.findByText(en.matchCreate.errors.leagueOptionsUnavailable);
    // Guidance agrees with the alert: options are unavailable, not "no eligible League".
    expect(
      screen.getByText(new RegExp(en.matchCreate.competition.guidance.unavailable))
    ).toBeTruthy();
    expect(
      screen.queryByText(new RegExp(en.matchCreate.competition.guidance.noEligible))
    ).toBeNull();
    mocks.leagues.mockResolvedValue(leagueResult([spring]));
    await user.click(screen.getByRole('button', { name: en.matches.retry }));
    await waitFor(() => expect(leagueSelect().value).toBe(springId));
  });

  it('reloads candidates and unfreezes the payload when the League closed after the options loaded', async () => {
    const user = userEvent.setup();
    mocks.leagues
      .mockResolvedValueOnce(leagueResult([spring]))
      .mockResolvedValueOnce(leagueResult([spring]))
      .mockResolvedValue(leagueResult([]));
    mocks.publish.mockRejectedValueOnce(new Error('MATCH_LEAGUE_CLOSED'));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(radio(en.matches.competition.ranked).checked).toBe(true));
    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await screen.findByText(en.matchCreate.errors.leagueUnavailable);
    expect(publishInput(0)).toMatchObject({ competition: 'ranked', league_id: springId });

    // The refreshed options no longer include the League: the retry is Unranked, same event id.
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(publishInput(1)).toMatchObject({ competition: 'unranked', league_id: null });
    expect(mocks.publish.mock.calls[1]?.[0].data.event_id).toBe(
      mocks.publish.mock.calls[0]?.[0].data.event_id
    );
  });

  it('resubmits the identical frozen payload when a network failure leaves the outcome unknown', async () => {
    const user = userEvent.setup();
    mocks.leagues.mockResolvedValue(leagueResult([spring]));
    mocks.publish.mockRejectedValueOnce(new Error('MATCH_PUBLISH_FAILED'));
    await mount();
    await makeCompetitive(user);
    await waitFor(() => expect(radio(en.matches.competition.ranked).checked).toBe(true));
    await readyToPublish(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[0].data).toEqual(mocks.publish.mock.calls[0]?.[0].data);
  });
});
