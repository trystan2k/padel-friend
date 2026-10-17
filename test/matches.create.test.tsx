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
  searchMatchInvitees: mocks.search,
  publishMatchEvent: mocks.publish
}));
vi.mock('../src/features/matches/match-photo.functions', () => ({
  copySavedVenueMatchPhotoFn: mocks.copy,
  finalizeMatchPhotoUploadFn: mocks.upload,
  removeUnpublishedMatchPhotoFn: mocks.remove,
  signUnattachedMatchPhotoFn: mocks.sign
}));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: mocks.browserClient
}));
import { CreateMatchPage } from '../src/features/matches/CreateMatchPage';

// The component pre-validates magic bytes before the browser uploads, so fixture
// files must start with a real PNG signature.
const pngFixture = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'x.png', {
    type: 'image/png'
  });
const uploadedKeys: string[] = [];

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
  locale: { matchCreate: { fields: { photo: string } } } = en
): Promise<string> {
  // The component composes the staging key client-side and uploads through the mocked
  // browser client; capture that key for the cleanup assertions below.
  const before = uploadedKeys.length;
  await user.upload(input(locale.matchCreate.fields.photo), pngFixture());
  await waitFor(() => expect(uploadedKeys.length).toBeGreaterThan(before));
  await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('img', { name: locale.matchCreate.fields.photo })).toBeTruthy()
  );
  return uploadedKeys[uploadedKeys.length - 1];
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
  uploadedKeys.length = 0;
  mocks.options.mockResolvedValue(options());
  mocks.search.mockResolvedValue([]);
  mocks.publish.mockResolvedValue({ event_id: 'match-id' });
  mocks.upload.mockResolvedValue('staged/photo.png');
  mocks.copy.mockResolvedValue('staged/saved-venue.png');
  mocks.remove.mockResolvedValue(undefined);
  mocks.sign.mockResolvedValue('https://signed.test/photo');
  mocks.navigate.mockResolvedValue(undefined);
  mocks.browserClient.mockReturnValue({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: '44444444-4444-4444-4444-444444444444' } } })
    },
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploadedKeys.push(key);
          return { error: null };
        }
      })
    }
  });
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
    await attachPhoto(user, pt);
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
    mocks.options
      .mockResolvedValueOnce(options())
      .mockResolvedValueOnce(options())
      .mockReturnValueOnce(refreshed.promise);
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

  it('loads saved venues using the initial community-scoped RPC response', async () => {
    await mount();
    await waitFor(() =>
      expect(mocks.options).toHaveBeenCalledWith({ data: { community_id: idA } })
    );
    expect(
      select(en.matchCreate.fields.savedVenue).querySelectorAll('option').length
    ).toBeGreaterThan(1);
  });

  it('ignores creation-options responses from an older community selection', async () => {
    const user = userEvent.setup();
    const stale = deferred<any>();
    const current = deferred<any>();
    mocks.options
      .mockResolvedValueOnce(options())
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
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: uploadedKeys[0] } })
    );
    expect(select(en.matchCreate.fields.savedVenue).value).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
    expect(input(en.matchCreate.fields.minLevel).value).toBe('2');
    await user.click(screen.getByRole('button', { name: en.matchCreate.next }));
    expect(screen.queryByText('Pat Player')).toBeNull();
  });

  it('copies an authorized saved-venue photo into the event photo path without requiring an upload', async () => {
    const user = userEvent.setup();
    const savedVenueId = '33333333-3333-4333-8333-333333333333';
    const photoOptions = {
      ...options(),
      saved_venues: [
        {
          id: savedVenueId,
          name: 'Saved court',
          photo_path: 'community-venue-photos/source.jpg',
          maps_url: 'https://www.google.com/maps/place/SavedCourt'
        }
      ]
    };
    mocks.options.mockResolvedValueOnce(photoOptions).mockResolvedValueOnce(photoOptions);
    await mount();
    await user.selectOptions(select(en.matchCreate.fields.savedVenue), savedVenueId);
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
    expect(mocks.copy.mock.calls[0]?.[0].data).toMatchObject({
      community_id: idA,
      saved_venue_id: savedVenueId
    });
    await screen.findByRole('img', { name: en.matchCreate.fields.photo });
    await fillRequired(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(mocks.publish.mock.calls[0]?.[0].data.input.photo_path).toBe('staged/saved-venue.png');
    expect(mocks.upload).not.toHaveBeenCalled();
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
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'stale.png', {
        type: 'image/png'
      })
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    const stagedKey = uploadedKeys[0];
    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    upload.resolve('staged/stale.png');
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: stagedKey } })
    );
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a signed staged-photo preview and localized unavailable fallback', async () => {
    const user = userEvent.setup();
    await mount();
    await attachPhoto(user);
    const preview = await screen.findByRole('img', { name: en.matchCreate.fields.photo });
    expect(preview.getAttribute('src')).toBe('https://signed.test/photo');
    await user.click(screen.getByRole('button', { name: en.matchCreate.photo.remove }));
    mocks.sign.mockRejectedValueOnce(new Error('unavailable'));
    await user.upload(input(en.matchCreate.fields.photo), pngFixture());
    expect(await screen.findByText(en.matchCreate.photo.unavailable)).toBeTruthy();
  });

  it('resolves and decodes the signed review image', async () => {
    const user = userEvent.setup();
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    const preview = await screen.findByRole('img', { name: en.matchCreate.fields.photo });
    expect(preview.getAttribute('src')).toBe('https://signed.test/photo');
    Object.defineProperties(preview, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 640 }
    });
    fireEvent.load(preview);
    expect(preview.getAttribute('data-decoded')).toBe('true');
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
    const firstKey = await attachPhoto(user);
    const replacementKey = await attachPhoto(user);
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: firstKey } })
    );
    await user.click(screen.getByRole('button', { name: en.matchCreate.photo.remove }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: replacementKey } })
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
    mocks.upload.mockResolvedValue('staged/photo.png');
    mocks.remove.mockResolvedValue(undefined);
    mocks.navigate.mockResolvedValue(undefined);
    uploadedKeys.length = 0;
    mocks.browserClient.mockReturnValue({
      auth: {
        getClaims: async () => ({
          data: { claims: { sub: '44444444-4444-4444-4444-444444444444' } }
        })
      },
      storage: {
        from: () => ({
          upload: async (key: string) => {
            uploadedKeys.push(key);
            return { error: null };
          }
        })
      }
    });
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

  it('publishes corrected details after a rejection with a fresh publication identity', async () => {
    const user = userEvent.setup();
    mocks.publish
      .mockRejectedValueOnce(new Error('MATCH_PUBLISH_FAILED'))
      .mockResolvedValueOnce({ event_id: 'ok' });
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await screen.findByText(en.matchCreate.errors.publishFailed);
    const rejectedId = mocks.publish.mock.calls[0]?.[0].data.event_id;
    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    await user.clear(input(en.matchCreate.fields.venueName));
    await user.type(input(en.matchCreate.fields.venueName), 'Corrected court');
    await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[0].data.event_id).not.toBe(rejectedId);
    expect(mocks.publish.mock.calls[1]?.[0].data.input.venue_name).toBe('Corrected court');
  });

  it('keeps a replacement photo bound after failed publication', async () => {
    const user = userEvent.setup();
    mocks.publish
      .mockRejectedValueOnce(new Error('MATCH_PUBLISH_FAILED'))
      .mockResolvedValueOnce({ event_id: 'ok' });
    await mount();
    await fillRequired(user);
    const originalPhoto = await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await screen.findByText(en.matchCreate.errors.publishFailed);
    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    const replacementPhoto = await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[0].data.input.photo_path).toBe(replacementPhoto);
    expect(mocks.remove).toHaveBeenCalledWith({ data: { object_key: originalPhoto } });
    expect(mocks.remove).not.toHaveBeenCalledWith({ data: { object_key: replacementPhoto } });
  });

  it('binds a saved-venue photo to the refreshed event identity after a failed publication', async () => {
    const user = userEvent.setup();
    const savedVenueId = '33333333-3333-4333-8333-333333333333';
    const photoOptions = {
      ...options(),
      saved_venues: [
        {
          id: savedVenueId,
          name: 'Saved court',
          photo_path: 'community-venue-photos/source.jpg',
          maps_url: 'https://www.google.com/maps/place/SavedCourt'
        }
      ]
    };
    mocks.options.mockResolvedValueOnce(photoOptions).mockResolvedValueOnce(photoOptions);
    mocks.publish
      .mockRejectedValueOnce(new Error('MATCH_PUBLISH_FAILED'))
      .mockResolvedValueOnce({ event_id: 'ok' });
    await mount();
    await fillRequired(user);
    await attachPhoto(user);
    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await screen.findByText(en.matchCreate.errors.publishFailed);
    const rejectedEventId = mocks.publish.mock.calls[0]?.[0].data.event_id;

    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    await user.click(button(en.matchCreate.previous));
    await user.selectOptions(select(en.matchCreate.fields.savedVenue), savedVenueId);
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
    const copiedEventId = mocks.copy.mock.calls[0]?.[0].data.event_id;
    expect(copiedEventId).not.toBe(rejectedEventId);
    await screen.findByRole('img', { name: en.matchCreate.fields.photo });

    await goReview(user);
    await user.click(button(en.matchCreate.publish));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[0].data.event_id).toBe(copiedEventId);
    expect(mocks.publish.mock.calls[1]?.[0].data.input.photo_path).toBe('staged/saved-venue.png');
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

  it('distinguishes options failure from an empty membership state', async () => {
    mocks.options.mockRejectedValueOnce(new Error('offline'));
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CreateMatchPage />
      </I18nextProvider>
    );
    expect(await screen.findByText(en.matchCreate.errors.optionsUnavailable)).toBeTruthy();
    expect(screen.queryByText(en.matchCreate.noCommunities)).toBeNull();
  });

  it('retries a failed scoped options request without clearing current form selections', async () => {
    const user = userEvent.setup();
    const failedRequest = deferred<any>();
    mocks.options
      .mockResolvedValueOnce(options())
      .mockResolvedValueOnce(options())
      .mockReturnValueOnce(failedRequest.promise)
      .mockResolvedValueOnce(options(undefined, 1, 5));
    await mount();

    await user.selectOptions(select(en.matchCreate.fields.community), idB);
    await waitFor(() => expect(mocks.options).toHaveBeenCalledTimes(3));
    await user.type(input(en.matchCreate.fields.venueName), 'Current court');
    await user.type(input(en.matchCreate.fields.price), '12.50');
    failedRequest.reject(new Error('offline'));

    expect(await screen.findByText(en.matchCreate.errors.optionsUnavailable)).toBeTruthy();
    await user.click(button(en.matches.retry));
    await waitFor(() => expect(mocks.options).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.queryByText(en.matchCreate.errors.optionsUnavailable)).toBeNull()
    );
    expect(mocks.options.mock.calls[3]?.[0]).toEqual({ data: { community_id: idB } });
    expect(input(en.matchCreate.fields.venueName).value).toBe('Current court');
    expect(input(en.matchCreate.fields.price).value).toBe('12.5');
  });
});
