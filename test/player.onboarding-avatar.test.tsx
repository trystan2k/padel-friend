/** @vitest-environment jsdom */
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { OnboardingAvatar } from '../src/features/player/OnboardingAvatar';
import { PlayerOnboarding } from '../src/features/player/PlayerOnboarding';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  claim: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  onboard: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  finalize: vi.fn<(input: { data: { objectKey: string } }) => Promise<unknown>>(),
  profile: vi.fn<() => Promise<{ avatar_signed_url: string | null }>>(),
  passwordState: vi.fn<() => Promise<{ pending: boolean; canSkip: boolean }>>(),
  upload: vi.fn<(file: File) => Promise<string>>(),
  assign: vi.fn<(url: string) => void>(),
  reload: vi.fn<() => void>()
}));
vi.mock('../src/features/player/player.functions', () => ({
  claimProvisionalPlayer: mocks.claim,
  onboardPlayer: mocks.onboard,
  completeAvatarUpload: mocks.finalize,
  getMyPlayerProfile: mocks.profile,
  getPasswordSetupState: mocks.passwordState
}));
vi.mock('../src/features/player/avatar-upload', () => ({ uploadOwnerAvatar: mocks.upload }));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: () => ({
    auth: { signOut: vi.fn<() => void>(), updateUser: vi.fn<() => void>() }
  })
}));

const copy = en.onboarding;
const createObjectURL = vi.fn<(file: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const KEY = 'user-1/photo.png';
const READY = {
  state: 'ready',
  displayName: 'Marta Provisional',
  initialLevel: 3.5,
  matchCount: 0,
  canEditLevel: true
} as const;

function png(name = 'me.png', type = 'image/png', size = 8) {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

function Harness({ name = 'Ana Lopez' }: { name?: string }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <OnboardingAvatar name={name} file={file} onFileChange={setFile} />
      <output data-testid="chosen">{file?.name ?? ''}</output>
    </>
  );
}

function renderIn(locale: 'en' | 'es' | 'pt-BR', ui: ReactNode) {
  return render(<I18nextProvider i18n={createI18n(locale)}>{ui}</I18nextProvider>);
}

const picker = () => screen.getByLabelText<HTMLInputElement>(copy.avatarLabel);
const uploader = () => userEvent.setup({ applyAccept: false });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  let counter = 0;
  createObjectURL.mockImplementation(() => `blob:preview-${++counter}`);
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  mocks.claim.mockResolvedValue();
  mocks.onboard.mockResolvedValue();
  mocks.finalize.mockResolvedValue({});
  mocks.profile.mockResolvedValue({ avatar_signed_url: null });
  mocks.passwordState.mockResolvedValue({ pending: true, canSkip: false });
  mocks.upload.mockResolvedValue(KEY);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: mocks.assign, reload: mocks.reload }
  });
});
afterEach(cleanup);

describe('OnboardingAvatar picker', () => {
  it('shows initials from the current name until a photo is chosen and follows name edits', () => {
    const view = renderIn('en', <Harness name="Ana Lopez" />);
    expect(screen.getByText('AL')).toBeTruthy();
    expect(screen.getByText(en.onboarding.avatarAlt.replace('{{name}}', 'Ana Lopez'))).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <Harness name="Bruno" />
      </I18nextProvider>
    );
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses a neutral description when the name is still empty', () => {
    renderIn('en', <Harness name="  " />);
    expect(screen.getByText(copy.avatarAltUnnamed)).toBeTruthy();
  });

  it('exposes a labelled file control with help text and an explicit skip action', () => {
    renderIn('en', <Harness />);
    const input = picker();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      copy.avatarHelp
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: copy.avatarSkip }).type).toBe(
      'button'
    );
  });

  it('previews a valid image in memory without uploading', async () => {
    renderIn('en', <Harness />);
    await uploader().upload(picker(), png());
    expect(screen.getByTestId('chosen').textContent).toBe('me.png');
    const img = screen.getByRole<HTMLImageElement>('img');
    expect(img.src).toBe('blob:preview-1');
    expect(img.alt).toBe('Profile photo of Ana Lopez');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects wrong types and oversize files with an alert and clears the choice', async () => {
    renderIn('en', <Harness />);
    const user = uploader();
    await user.upload(picker(), png('ok.png'));
    await user.upload(picker(), png('anim.gif', 'image/gif'));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.avatarInvalid);
    expect(screen.getByTestId('chosen').textContent).toBe('');
    expect(picker().getAttribute('aria-invalid')).toBe('true');
    expect(picker().getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').getAttribute('id')
    );
    await user.upload(picker(), png('big.png', 'image/png', 2 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert').textContent).toBe(copy.avatarInvalid);
    expect(screen.getByTestId('chosen').textContent).toBe('');
    await user.upload(picker(), png('good.webp', 'image/webp'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('chosen').textContent).toBe('good.webp');
  });

  it('skip clears the file, the native input, the preview and revokes the object URL', async () => {
    renderIn('en', <Harness />);
    const user = uploader();
    await user.upload(picker(), png());
    await user.click(screen.getByRole('button', { name: copy.avatarSkip }));
    expect(screen.getByTestId('chosen').textContent).toBe('');
    expect(picker().value).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AL')).toBeTruthy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('revokes the previous object URL on replacement and everything on unmount', async () => {
    const view = renderIn('en', <Harness />);
    const user = uploader();
    await user.upload(picker(), png('a.png'));
    await user.upload(picker(), png('b.png'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:preview-2');
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
  });

  it('treats a cancelled picker as neither an error nor a reset', async () => {
    renderIn('en', <Harness />);
    await uploader().upload(picker(), png());
    fireEvent.change(picker(), { target: { files: [] } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('chosen').textContent).toBe('me.png');
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('disables the picker and skip while the form is frozen', () => {
    renderIn(
      'en',
      <OnboardingAvatar
        name="Ana"
        file={null}
        onFileChange={vi.fn<(file: File | null) => void>()}
        disabled
      />
    );
    expect(picker().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: copy.avatarSkip }).disabled).toBe(
      true
    );
  });

  it('has the same avatar keys in every locale and no empty copy', () => {
    const keys = Object.keys(en.onboarding)
      .filter((key) => key.startsWith('avatar'))
      .sort();
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of [es, ptBR]) {
      expect(
        Object.keys(locale.onboarding)
          .filter((key) => key.startsWith('avatar'))
          .sort()
      ).toEqual(keys);
    }
    for (const locale of [en, es, ptBR])
      for (const key of keys)
        expect((locale.onboarding as Record<string, string>)[key]?.trim()).toBeTruthy();
  });
});

async function fillAndPick(options: { claim?: boolean; photo?: File | null } = {}) {
  const { claim = false, photo = png() } = options;
  if (!claim) await userEvent.type(screen.getByLabelText(copy.name), 'Ana Lopez');
  await userEvent.click(screen.getAllByRole('radio', { name: copy.sideLeftShort })[0]!);
  if (photo) await uploader().upload(picker(), photo);
}

const submitName = (claim: boolean) => new RegExp(claim ? en.auth.claim.submit : copy.save);

function mountFlow(claim: boolean, next?: string) {
  return renderIn('en', <PlayerOnboarding next={next} claim={claim ? { ...READY } : undefined} />);
}

describe.each([
  { claim: false, label: 'direct onboarding' },
  { claim: true, label: 'claim' }
])('photo sequencing: $label', ({ claim }) => {
  const create = () => (claim ? mocks.claim : mocks.onboard);
  const other = () => (claim ? mocks.onboard : mocks.claim);

  it('creates the profile first, then uploads, finalizes and only then continues', async () => {
    const order: string[] = [];
    create().mockImplementation(async () => void order.push('create'));
    mocks.upload.mockImplementation(async () => (order.push('upload'), KEY));
    mocks.finalize.mockImplementation(async () => (order.push('finalize'), {}));
    mocks.passwordState.mockImplementation(
      async () => (
        order.push('password'),
        {
          pending: false,
          canSkip: false
        }
      )
    );
    mocks.assign.mockImplementation(() => void order.push('navigate'));
    mountFlow(claim, '/matches/e1');
    await fillAndPick({ claim });
    expect(mocks.upload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalled());
    expect(order).toEqual(
      claim
        ? ['create', 'upload', 'finalize', 'password', 'navigate']
        : ['create', 'upload', 'finalize', 'navigate']
    );
    expect(mocks.finalize).toHaveBeenCalledWith({ data: { objectKey: KEY } });
    expect(mocks.assign).toHaveBeenCalledWith(
      claim ? '/matches/e1' : '/onboarding/community?next=%2Fmatches%2Fe1'
    );
    expect(create()).toHaveBeenCalledTimes(1);
    expect(other()).not.toHaveBeenCalled();
    // The photo never travels in the JSON profile payload.
    expect(Object.keys(create().mock.calls[0]![0].data).sort()).toEqual([
      'bio',
      'display_name',
      'dominant_hand',
      'initial_level',
      'preferred_playing_days',
      'preferred_playing_times',
      'preferred_side'
    ]);
  });

  it('keeps the password step after a claim photo', async () => {
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await waitFor(() =>
      expect(claim ? mocks.passwordState : mocks.assign).toHaveBeenCalledTimes(1)
    );
    expect(
      screen.queryAllByRole('heading', { level: 1, name: en.auth.claim.passwordTitle })
    ).toHaveLength(claim ? 1 : 0);
    expect(mocks.assign.mock.calls).toEqual(claim ? [] : [['/onboarding/community']]);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
  });

  it('never touches storage when no photo is chosen or the photo was skipped', async () => {
    mountFlow(claim);
    await fillAndPick({ claim, photo: png() });
    await userEvent.click(screen.getByRole('button', { name: copy.avatarSkip }));
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await waitFor(() => expect(create()).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        mocks.passwordState.mock.calls.length + mocks.assign.mock.calls.length
      ).toBeGreaterThan(0)
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('does not upload when the profile step fails and lets the user resubmit with the photo', async () => {
    create().mockRejectedValueOnce(new Error('boom'));
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      claim ? en.auth.claim.failed : copy.failed
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledTimes(1));
    expect(create()).toHaveBeenCalledTimes(2);
  });

  it('after an upload failure offers retry, which never resubmits the profile', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('network'));
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.avatarFailed);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: submitName(claim) })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(copy.name).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: copy.avatarRetry }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledTimes(1));
    expect(create()).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(claim ? mocks.passwordState : mocks.assign).toHaveBeenCalled());
  });

  it('reuses the uploaded key when only the finalize step failed', async () => {
    mocks.finalize.mockRejectedValueOnce(new Error('AVATAR_CONFLICT'));
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await screen.findByText(copy.avatarFailed);
    await userEvent.click(screen.getByRole('button', { name: copy.avatarRetry }));
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.finalize.mock.calls.map((call) => call[0].data.objectKey)).toEqual([KEY, KEY]);
    expect(create()).toHaveBeenCalledTimes(1);
  });

  it('trusts the authoritative profile when an unknown finalize outcome already stored an avatar', async () => {
    mocks.finalize.mockRejectedValueOnce(new Error('timeout'));
    mocks.profile.mockResolvedValue({ avatar_signed_url: 'https://signed.example/a.png' });
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await screen.findByText(copy.avatarFailed);
    await userEvent.click(screen.getByRole('button', { name: copy.avatarRetry }));
    await waitFor(() => expect(claim ? mocks.passwordState : mocks.assign).toHaveBeenCalled());
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('continues without the photo using the original continuation and no new profile call', async () => {
    mocks.upload.mockRejectedValue(new Error('network'));
    mountFlow(claim, '/matches/e1');
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await screen.findByText(copy.avatarFailed);
    await userEvent.click(screen.getByRole('button', { name: copy.avatarContinue }));
    await waitFor(() =>
      expect(claim ? mocks.passwordState : mocks.assign).toHaveBeenCalledTimes(1)
    );
    expect(mocks.assign.mock.calls).toEqual(
      claim ? [] : [['/onboarding/community?next=%2Fmatches%2Fe1']]
    );
    expect(create()).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('suppresses a double submit while the photo is still uploading', async () => {
    let release!: (key: string) => void;
    mocks.upload.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    mountFlow(claim);
    await fillAndPick({ claim });
    const form = screen.getByRole('button', { name: submitName(claim) }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    fireEvent.submit(form);
    release(KEY);
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledTimes(1));
    expect(create()).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('routes an expired session during the photo step to login without a second profile call', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    mountFlow(claim);
    await fillAndPick({ claim });
    await userEvent.click(screen.getByRole('button', { name: submitName(claim) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/login?next=/onboarding'));
    expect(create()).toHaveBeenCalledTimes(1);
  });
});

describe('photo with claim error routing', () => {
  it('skips the upload when the identity was already claimed elsewhere', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('PLAYER_CLAIM_NOT_PENDING'));
    mountFlow(true, '/matches/e1');
    await fillAndPick({ claim: true });
    await userEvent.click(screen.getByRole('button', { name: submitName(true) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('reloads without uploading when mailbox verification was lost', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('PLAYER_CLAIM_NOT_VERIFIED'));
    mountFlow(true);
    await fillAndPick({ claim: true });
    await userEvent.click(screen.getByRole('button', { name: submitName(true) }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
