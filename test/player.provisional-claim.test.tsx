/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { ClaimPasswordStep } from '../src/features/player/ClaimPasswordStep';
import { PlayerOnboarding } from '../src/features/player/PlayerOnboarding';
import { ProvisionalClaimVerify } from '../src/features/player/ProvisionalClaimVerify';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  claim: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  onboard: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  signOut: vi.fn<() => Promise<{ error: unknown }>>(),
  updateUser: vi.fn<(attrs: { password: string }) => Promise<{ error: unknown }>>(),
  passwordState: vi.fn<() => Promise<{ pending: boolean; canSkip: boolean }>>(),
  assign: vi.fn<(url: string) => void>(),
  reload: vi.fn<() => void>()
}));
vi.mock('../src/features/player/player.functions', () => ({
  claimProvisionalPlayer: mocks.claim,
  onboardPlayer: mocks.onboard,
  getPasswordSetupState: mocks.passwordState
}));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: () => ({
    auth: {
      signOut: mocks.signOut,
      updateUser: mocks.updateUser
    }
  })
}));

const READY = {
  state: 'ready',
  displayName: 'Marta Provisional',
  initialLevel: 3.5,
  matchCount: 2
} as const;
const t = en.auth.claim;

function mount(claim: { canEditLevel: boolean }, next?: string) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlayerOnboarding next={next} claim={{ ...READY, ...claim }} />
    </I18nextProvider>
  );
}

async function pickSide() {
  // The first "Left" radio is the court side; the second is the dominant hand.
  await userEvent.click(screen.getAllByRole('radio', { name: en.onboarding.sideLeftShort })[0]!);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.claim.mockResolvedValue();
  mocks.signOut.mockResolvedValue({ error: null });
  // Right after the claim the server owes a password; once one is set it no longer does.
  mocks.passwordState.mockResolvedValue({ pending: true, canSkip: false });
  mocks.updateUser.mockImplementation(async () => {
    mocks.passwordState.mockResolvedValue({ pending: false, canSkip: false });
    return { error: null };
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: mocks.assign, reload: mocks.reload }
  });
});
afterEach(cleanup);

describe('claim onboarding', () => {
  it('prefills the provisional name and level with claim copy', () => {
    mount({ canEditLevel: true });
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(en.onboarding.name).value).toBe(
      'Marta Provisional'
    );
    expect(screen.getByLabelText<HTMLInputElement>(en.onboarding.preciseLevel).value).toBe('3.5');
    expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(false);
    expect(screen.getByText(t.levelNote)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(t.submit) })).toBeTruthy();
  });

  it('locks both level controls and explains why once rated history exists', () => {
    mount({ canEditLevel: false });
    expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(en.onboarding.preciseLevel).disabled).toBe(true);
    expect(screen.getByText(t.levelLocked)).toBeTruthy();
    expect(screen.queryByText(t.levelNote)).toBeNull();
  });

  it('requires an explicit court side before claiming', async () => {
    mount({ canEditLevel: true });
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    expect(screen.getByText(en.onboarding.validationSide)).toBeTruthy();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('counts the name limit in code points: 80 emoji accepted, 81 rejected without submitting', async () => {
    mount({ canEditLevel: true });
    const input = screen.getByLabelText<HTMLInputElement>(en.onboarding.name);
    fireEvent.change(input, { target: { value: '🎾'.repeat(80) } });
    expect(screen.queryByText(en.onboarding.validationName)).toBeNull();
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    await pickSide();
    fireEvent.change(input, { target: { value: '🎾'.repeat(81) } });
    expect(screen.getByText(en.onboarding.validationName)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    expect(screen.getByText(en.onboarding.validationName)).toBeTruthy();
    expect(mocks.claim).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '🎾'.repeat(80) } });
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('shows the localized invited-match notice above the step badge, singular and plural', () => {
    const view = mount({ canEditLevel: true });
    const notice = screen.getByText('You were invited to 2 matches.');
    expect(notice.compareDocumentPosition(screen.getByText(t.step))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    view.unmount();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <PlayerOnboarding claim={{ ...READY, canEditLevel: true, matchCount: 1 }} />
      </I18nextProvider>
    );
    expect(screen.getByText('You were invited to 1 match.')).toBeTruthy();
    cleanup();
    render(
      <I18nextProvider i18n={createI18n('es')}>
        <PlayerOnboarding claim={{ ...READY, canEditLevel: true, matchCount: 3 }} />
      </I18nextProvider>
    );
    expect(screen.getByText('Te invitaron a 3 partidos.')).toBeTruthy();
  });

  it('claims through the claim function only, then sets a password before continuing', async () => {
    mount({ canEditLevel: true }, '/matches/e1');
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    expect(await screen.findByRole('heading', { level: 1, name: t.passwordTitle })).toBeTruthy();
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t.passwordSkip })).toBeNull();
    await userEvent.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'new-password-1');
    await userEvent.type(
      screen.getByLabelText(en.auth.resetConfirmPasswordLabel),
      'new-password-1'
    );
    await userEvent.click(screen.getByRole('button', { name: en.auth.resetSubmit }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
    expect(mocks.claim).toHaveBeenCalledWith({
      data: {
        display_name: 'Marta Provisional',
        preferred_side: 'LEFT',
        initial_level: 3.5,
        dominant_hand: null,
        bio: null
      }
    });
    expect(mocks.onboard).not.toHaveBeenCalled();
  });

  it('lets a claimant with a verified provider identity skip the password', async () => {
    mocks.passwordState.mockResolvedValue({ pending: false, canSkip: true });
    mount({ canEditLevel: true }, '/matches/e1');
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await userEvent.click(await screen.findByRole('button', { name: t.passwordSkip }));
    expect(screen.queryByText(t.passwordSkipHelp)).toBeTruthy();
    expect(mocks.assign).toHaveBeenCalledWith('/matches/e1');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('validates the password, reports a failed update and allows a retry', async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: new Error('boom') });
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    const password = await screen.findByLabelText(en.auth.resetNewPasswordLabel);
    const confirmation = screen.getByLabelText(en.auth.resetConfirmPasswordLabel);
    const submit = screen.getByRole('button', { name: en.auth.resetSubmit });
    await userEvent.type(password, 'short');
    await userEvent.click(submit);
    expect(screen.getByText(en.auth.resetInvalid)).toBeTruthy();
    await userEvent.clear(password);
    await userEvent.type(password, 'new-password-1');
    await userEvent.type(confirmation, 'different-1');
    await userEvent.click(submit);
    expect(screen.getByText(en.auth.resetMismatch)).toBeTruthy();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    await userEvent.clear(confirmation);
    await userEvent.type(confirmation, 'new-password-1');
    await userEvent.click(submit);
    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.resetFailed);
    expect(mocks.assign).not.toHaveBeenCalled();
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.updateUser).toHaveBeenCalledTimes(2);
  });

  it('routes to login with the expired-session message when the session is gone', async () => {
    mocks.updateUser.mockResolvedValueOnce({
      error: Object.assign(new Error('missing'), { name: 'AuthSessionMissingError' })
    });
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await userEvent.type(
      await screen.findByLabelText(en.auth.resetNewPasswordLabel),
      'new-password-1'
    );
    await userEvent.type(
      screen.getByLabelText(en.auth.resetConfirmPasswordLabel),
      'new-password-1'
    );
    await userEvent.click(screen.getByRole('button', { name: en.auth.resetSubmit }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/login?expired=1'));
  });

  it('moves focus to the password step heading when it replaces the claim form', async () => {
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    const heading = await screen.findByRole('heading', { level: 1, name: t.passwordTitle });
    expect(document.activeElement).toBe(heading);
  });

  it('shows the skip only when the server says a verified provider identity exists', async () => {
    // Pending with no skip: a provider identity in the browser must not matter.
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await screen.findByRole('heading', { level: 1, name: t.passwordTitle });
    expect(screen.queryByRole('button', { name: t.passwordSkip })).toBeNull();
    cleanup();

    // Nothing owed and nothing to offer: straight to the destination.
    mocks.passwordState.mockResolvedValue({ pending: false, canSkip: false });
    mount({ canEditLevel: true }, '/matches/e1');
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));
  });

  it('fails closed when the password-setup lookup fails: step without a skip', async () => {
    mocks.passwordState.mockRejectedValue(new Error('down'));
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await screen.findByRole('heading', { level: 1, name: t.passwordTitle });
    expect(screen.queryByRole('button', { name: t.passwordSkip })).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('locks submission until the claim and the password-setup lookup are done', async () => {
    let release!: (state: { pending: boolean; canSkip: boolean }) => void;
    mocks.passwordState.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mount({ canEditLevel: true });
    await pickSide();
    const form = screen.getByRole('button', { name: new RegExp(t.submit) }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.passwordState).toHaveBeenCalledTimes(1));
    // The claim has returned; the lookup is still in flight: a second submit must be ignored.
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    release({ pending: true, canSkip: false });
    await screen.findByRole('heading', { level: 1, name: t.passwordTitle });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('keeps asking for the password after a reload until the server sees it', async () => {
    // Interrupted claim: the route renders the step from the server flag, with no claim form.
    mocks.passwordState.mockResolvedValue({ pending: true, canSkip: false });
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ClaimPasswordStep next="/matches/e1" />
      </I18nextProvider>
    );
    const heading = screen.getByRole('heading', { level: 1, name: t.passwordTitle });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole('button', { name: t.passwordSkip })).toBeNull();
    mocks.updateUser.mockImplementationOnce(async () => ({ error: null })); // password write did not stick
    await userEvent.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'new-password-1');
    await userEvent.type(
      screen.getByLabelText(en.auth.resetConfirmPasswordLabel),
      'new-password-1'
    );
    await userEvent.click(screen.getByRole('button', { name: en.auth.resetSubmit }));
    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.resetFailed);
    expect(mocks.assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: en.auth.resetSubmit }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));
  });

  it('continues when the identity was already claimed and reloads when verification was lost', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('PLAYER_CLAIM_NOT_PENDING'));
    mount({ canEditLevel: true }, '/matches/e1');
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));

    cleanup();
    mocks.claim.mockRejectedValueOnce(new Error('PLAYER_CLAIM_NOT_VERIFIED'));
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it('shows the claim failure message for any other error and stays on the form', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('PLAYER_CLAIM_LEVEL_LOCKED'));
    mount({ canEditLevel: true });
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.failed);
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('regular onboarding is unchanged when no claim is present', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <PlayerOnboarding />
      </I18nextProvider>
    );
    expect(screen.getByRole('heading', { level: 1, name: en.onboarding.title })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(en.onboarding.name).value).toBe('');
    expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(false);
  });
});

describe('unverified claim step', () => {
  it('signs out and hands over to the recovery flow', async () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ProvisionalClaimVerify />
      </I18nextProvider>
    );
    expect(screen.getByRole('heading', { level: 1, name: t.verifyTitle })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: t.verifyAction }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/forgot-password'));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('keeps the session and reports a failed sign-out', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('network') });
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ProvisionalClaimVerify />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: t.verifyAction }));
    expect((await screen.findByRole('alert')).textContent).toBe(t.verifyFailed);
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});

describe('claim copy', () => {
  it('has the same keys in every locale', () => {
    const keys = Object.keys(en.auth.claim).sort();
    expect(Object.keys(es.auth.claim).sort()).toEqual(keys);
    expect(Object.keys(ptBR.auth.claim).sort()).toEqual(keys);
  });
});
