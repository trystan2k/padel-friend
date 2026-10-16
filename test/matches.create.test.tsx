/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

const mocks = vi.hoisted(() => ({
  options: vi.fn<(...args: any[]) => Promise<any>>(),
  search: vi.fn<(...args: any[]) => Promise<any>>(),
  publish:
    vi.fn<
      (request: {
        data: { event_id: string; input: Record<string, unknown>; invitee_ids: string[] };
      }) => Promise<{ event_id: string }>
    >(),
  upload: vi.fn<(...args: any[]) => Promise<string>>(),
  remove: vi.fn<(...args: any[]) => Promise<void>>(),
  navigate: vi.fn<(...args: any[]) => Promise<void>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate
}));
vi.mock('../src/features/matches/matches.functions', () => ({
  getMatchCreationOptions: mocks.options,
  searchMatchInvitees: mocks.search,
  publishMatchEvent: mocks.publish
}));
vi.mock('../src/features/matches/match-photo.functions', () => ({
  uploadMatchPhotoFn: mocks.upload,
  removeUnpublishedMatchPhotoFn: mocks.remove
}));
import { CreateMatchPage } from '../src/features/matches/CreateMatchPage';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const options = (
  communities = [
    { id: idA, name: 'Club A', timezone: 'Europe/Madrid', currency: 'EUR' },
    { id: idB, name: 'Club B', timezone: 'America/Sao_Paulo', currency: 'BRL' }
  ],
  min: number | null = 2,
  max: number | null = 4
) => ({
  communities,
  level_defaults: { min, max, level: 3 },
  saved_venues: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Saved court',
      photo_path: null,
      maps_url: null
    }
  ]
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function input(label: string | RegExp) {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new TypeError('Expected input');
  return element;
}
function button(label: string) {
  const element = screen.getByRole('button', { name: label });
  if (!(element instanceof HTMLButtonElement)) throw new TypeError('Expected button');
  return element;
}
function select(label: string) {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) throw new TypeError('Expected select');
  return element;
}
async function mount(locale = 'en') {
  const view = render(
    <I18nextProvider i18n={createI18n(locale)}>
      <CreateMatchPage />
    </I18nextProvider>
  );
  await screen.findByRole('heading', {
    name:
      locale === 'en'
        ? en.matchCreate.title
        : locale === 'pt-BR'
          ? pt.matchCreate.title
          : es.matchCreate.title
  });
  await screen.findByRole('combobox', { name: /community|comunidade/i });
  return view;
}
async function attachPhoto(
  user: ReturnType<typeof userEvent.setup>,
  name = 'court.png',
  locale: { matchCreate: { fields: { photo: string } } } = en
) {
  mocks.upload.mockResolvedValueOnce(`owned/${name}`);
  await user.upload(
    input(locale.matchCreate.fields.photo),
    new File(['photo bytes'], name, { type: 'image/png' })
  );
  await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('img', { name: locale.matchCreate.fields.photo })).toBeTruthy()
  );
}
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en.matchCreate.fields.date), '2030-05-20');
  await user.type(screen.getByLabelText(en.matchCreate.fields.startTime), '18:30');
  await user.type(screen.getByLabelText(en.matchCreate.fields.venueName), 'Court Central');
  await user.type(
    screen.getByLabelText(en.matchCreate.fields.mapsUrl),
    'https://www.google.com/maps/place/Central'
  );
}
async function goReview(user: ReturnType<typeof userEvent.setup>, next = en.matchCreate.next) {
  await user.click(screen.getByRole('button', { name: next }));
  await user.click(screen.getByRole('button', { name: next }));
  await user.click(screen.getByRole('button', { name: next }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockResolvedValue(options());
  mocks.search.mockResolvedValue([]);
  mocks.publish.mockResolvedValue({ event_id: 'match-id' });
  mocks.upload.mockResolvedValue('owned/photo.png');
  mocks.remove.mockResolvedValue(undefined);
  mocks.navigate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('create match wizard', () => {
  it('navigates forward/back and moves focus to each new step heading', async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    expect(document.activeElement).toBe(screen.getByLabelText(en.matchCreate.invitees.search));
    expect(screen.getByText(en.matchCreate.steps.players)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    expect(document.activeElement).toBe(screen.getByLabelText(en.matchCreate.fields.community));
    expect(screen.getByLabelText(en.matchCreate.fields.venueName)).toBeTruthy();
  });

  it('validates required details on publish, localizes errors, associates them, and focuses first invalid input', async () => {
    const user = userEvent.setup();
    await mount('pt-BR');
    await attachPhoto(user, 'court.png', pt);
    await goReview(user, pt.matchCreate.next);
    await user.click(screen.getByRole('button', { name: pt.matchCreate.publish }));
    expect((await screen.findAllByText(pt.matchCreate.errors.required)).length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText(new RegExp(pt.matchCreate.fields.date)).getAttribute('aria-invalid')
    ).toBe('true');
    expect(document.activeElement).toBe(
      screen.getByLabelText(new RegExp(pt.matchCreate.fields.date))
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('applies authoritative level defaults, supports edits and disabling, and preserves edits across late options', async () => {
    const user = userEvent.setup();
    const refreshed = deferred<any>();
    mocks.options.mockResolvedValueOnce(options()).mockReturnValueOnce(refreshed.promise);
    await mount();
    const min = input(en.matchCreate.fields.minLevel);
    expect(min.value).toBe('2');
    await user.clear(min);
    await user.type(min, '2.5');
    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    const changedMin = input(en.matchCreate.fields.minLevel);
    await user.clear(changedMin);
    await user.type(changedMin, '3.5');
    refreshed.resolve(options(undefined, 1, 5));
    await waitFor(() => expect(input(en.matchCreate.fields.maxLevel).value).toBe('5'));
    expect(input(en.matchCreate.fields.minLevel).value).toBe('3.5');
    await user.click(screen.getByLabelText(en.matchCreate.fields.levelRestriction));
    expect(screen.queryByLabelText(en.matchCreate.fields.minLevel)).toBeNull();
  });

  it('ignores creation-options responses from an older community selection', async () => {
    const user = userEvent.setup();
    const stale = deferred<any>();
    const current = deferred<any>();
    mocks.options
      .mockResolvedValueOnce(options())
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    await mount();
    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    await user.selectOptions(select(en.matchCreate.fields.community), idA);
    current.resolve({
      ...options(),
      level_defaults: { min: 5, max: 6, level: 5.5 },
      saved_venues: []
    });
    await waitFor(() => expect(input(en.matchCreate.fields.minLevel).value).toBe('5'));
    stale.resolve({
      ...options(),
      level_defaults: { min: 1, max: 2, level: 1.5 },
      saved_venues: []
    });
    await waitFor(() => expect(input(en.matchCreate.fields.minLevel).value).toBe('5'));
    expect(input(en.matchCreate.fields.maxLevel).value).toBe('6');
  });

  it('clears venue/photo/invitees and resets defaults after community change, cleaning abandoned staging photo', async () => {
    const user = userEvent.setup();
    await mount();
    await attachPhoto(user);
    await user.selectOptions(
      select(en.matchCreate.fields.savedVenue),
      '33333333-3333-4333-8333-333333333333'
    );
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    mocks.search.mockResolvedValueOnce([{ id: 'player-id', name: 'Pat Player' }]);
    await user.type(screen.getByLabelText(en.matchCreate.invitees.search), 'player');
    expect(await screen.findByText('Pat Player')).toBeTruthy();
    await user.click(screen.getByText('Pat Player'));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: 'owned/court.png' } })
    );
    expect(select(en.matchCreate.fields.savedVenue).value).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
    expect(input(en.matchCreate.fields.minLevel).value).toBe('2');
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    expect(screen.queryByText('Pat Player')).toBeNull();
  });

  it('discards stale invitee search responses after a newer query resolves', async () => {
    const user = userEvent.setup();
    const old = deferred<any[]>();
    const fresh = deferred<any[]>();
    mocks.search.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await mount();
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    const search = screen.getByLabelText(en.matchCreate.invitees.search);
    await user.type(search, 'old');
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
    await user.clear(search);
    await user.type(search, 'new');
    fresh.resolve([{ id: 'new', name: 'New result' }]);
    await screen.findByText('New result');
    old.resolve([{ id: 'old', name: 'Old result' }]);
    await waitFor(() => expect(screen.queryByText('Old result')).toBeNull());
    expect(screen.getByText('New result')).toBeTruthy();
  });

  it('discards a stale photo upload and cleans its owned staging key', async () => {
    const user = userEvent.setup();
    const upload = deferred<string>();
    mocks.upload.mockReturnValueOnce(upload.promise);
    await mount();
    await user.upload(
      input(en.matchCreate.fields.photo),
      new File(['bytes'], 'stale.png', { type: 'image/png' })
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    upload.resolve('owned/stale.png');
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: 'owned/stale.png' } })
    );
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('requires photo, supports replacement/removal cleanup, and disables publish until upload completes', async () => {
    const user = userEvent.setup();
    await mount();
    await fillRequired(user);
    await goReview(user);
    const publish = button(en.matchCreate.publish);
    expect(publish.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await attachPhoto(user, 'first.png');
    await attachPhoto(user, 'replacement.png');
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: 'owned/first.png' } })
    );
    await user.click(screen.getByRole('button', { name: en.matchCreate.photo.remove }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: 'owned/replacement.png' } })
    );
  });

  it('accepts zero and decimal informational prices, and limits currency options', async () => {
    const user = userEvent.setup();
    await mount();
    const price = input(en.matchCreate.fields.price);
    await user.clear(price);
    await user.type(price, '0');
    expect(price.value).toBe('0');
    await user.clear(price);
    await user.type(price, '12.50');
    expect(price.value).toBe('12.5');
    const currency = select(en.matchCreate.fields.currency);
    expect(
      within(currency)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['BRL', 'USD', 'EUR']);
    fireEvent.change(currency, { target: { value: 'GBP' } });
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    expect(await screen.findByText(en.matchCreate.errors.unsupportedCurrency)).toBeTruthy();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('publishes zero and decimal informational prices with supported currencies, and clears disabled level bounds', async () => {
    const user = userEvent.setup();
    await mount();
    await user.clear(input(en.matchCreate.fields.price));
    await user.type(input(en.matchCreate.fields.price), '0');
    await user.selectOptions(select(en.matchCreate.fields.currency), 'BRL');
    await user.click(screen.getByLabelText(en.matchCreate.fields.levelRestriction));
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(mocks.publish.mock.calls[0]?.[0].data.input.price).toBe('0');
    expect(mocks.publish.mock.calls[0]?.[0].data.input.currency).toBe('BRL');
    expect(mocks.publish.mock.calls[0]?.[0].data.input.min_level).toBeNull();
    cleanup();
    vi.clearAllMocks();
    mocks.options.mockResolvedValue(options());
    mocks.search.mockResolvedValue([]);
    mocks.publish.mockResolvedValue({ event_id: 'published' });
    mocks.upload.mockResolvedValue('owned/photo.png');
    mocks.remove.mockResolvedValue(undefined);
    mocks.navigate.mockResolvedValue(undefined);
    await mount();
    await user.clear(input(en.matchCreate.fields.price));
    await user.type(input(en.matchCreate.fields.price), '12.50');
    await user.selectOptions(select(en.matchCreate.fields.currency), 'USD');
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(mocks.publish.mock.calls[0]?.[0].data.input.price).toBe('12.5');
    expect(mocks.publish.mock.calls[0]?.[0].data.input.currency).toBe('USD');
  });

  it('shows default cutoff instant with timezone and rejects cutoff at or after start', async () => {
    const user = userEvent.setup();
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    expect(screen.getByText(/May 20, 2030, 5:30 PM · Europe\/Madrid/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.type(screen.getByLabelText(en.matchCreate.fields.cutoff), '2030-05-20T18:30');
    await goReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    expect(await screen.findByText(en.matchCreate.errors.invalidCutoff)).toBeTruthy();
    const cutoff = input(new RegExp(en.matchCreate.fields.cutoff));
    await user.clear(cutoff);
    await user.type(cutoff, '2030-05-20T18:31');
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    expect(await screen.findByText(en.matchCreate.errors.invalidCutoff)).toBeTruthy();
  });

  it('accepts a custom community-local cutoff strictly before start and sends its authoritative instant', async () => {
    const user = userEvent.setup();
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await user.type(screen.getByLabelText(en.matchCreate.fields.cutoff), '2030-05-20T17:00');
    await goReview(user);
    await user.click(screen.getByRole('button', { name: en.matchCreate.publish }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(mocks.publish.mock.calls[0]?.[0].data.input.cutoff_at).toBe('2030-05-20T15:00:00.000Z');
  });

  it('prevents duplicate submits, reuses event UUID on retry, retains form after localized failure, then navigates on success', async () => {
    const user = userEvent.setup();
    const first = deferred<any>();
    mocks.publish
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('MATCH_PUBLISH_FAILED'))
      .mockResolvedValueOnce({ event_id: 'published' });
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    const publishButton = button(en.matchCreate.publish);
    await user.click(publishButton);
    await user.click(publishButton);
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(publishButton.disabled).toBe(true);
    first.resolve({ event_id: 'success' });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    mocks.navigate.mockClear();
    await user.click(publishButton);
    await screen.findByText(en.matchCreate.errors.publishFailed);
    const firstId = mocks.publish.mock.calls[0]?.[0].data.event_id;
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    await user.click(screen.getByRole('button', { name: en.matchCreate.previous }));
    expect(input(en.matchCreate.fields.venueName).value).toBe('Court Central');
    await goReview(user);
    const retryButton = screen.getByRole('button', { name: en.matchCreate.publish });
    await user.click(retryButton);
    expect(mocks.publish.mock.calls.at(-1)?.[0].data.event_id).toBe(firstId);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });

  it('renders localized community discovery empty state and avoids unsupported controls or raw enum identifiers', async () => {
    mocks.options.mockResolvedValueOnce(options([], null, null));
    render(
      <I18nextProvider i18n={createI18n('es')}>
        <CreateMatchPage />
      </I18nextProvider>
    );
    expect(await screen.findByText(es.matchCreate.noCommunities)).toBeTruthy();
    expect(screen.getByRole('heading', { name: es.matchCreate.title })).toBeTruthy();
    expect(screen.queryByText('Create match')).toBeNull();
    expect(
      screen.getByRole('link', { name: es.matchCreate.discoverCommunities }).getAttribute('href')
    ).toBe('/onboarding/community');
    expect(
      screen.queryByText(
        /ranked|league|filter|pay now|book now|register|PREDEFINED_TEAMS|POST_MATCH_TEAMS/i
      )
    ).toBeNull();
  });
});
