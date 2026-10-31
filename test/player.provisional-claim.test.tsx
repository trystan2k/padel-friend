/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { PlayerOnboarding } from '../src/features/player/PlayerOnboarding';
import { ProvisionalClaimVerify } from '../src/features/player/ProvisionalClaimVerify';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  claim: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  onboard: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  signOut: vi.fn<() => Promise<{ error: unknown }>>(),
  assign: vi.fn<(url: string) => void>(),
  reload: vi.fn<() => void>()
}));
vi.mock('../src/features/player/player.functions', () => ({
  claimProvisionalPlayer: mocks.claim,
  onboardPlayer: mocks.onboard
}));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: () => ({ auth: { signOut: mocks.signOut } })
}));

const READY = { state: 'ready', displayName: 'Marta Provisional', initialLevel: 3.5 } as const;
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

  it('claims through the claim function only and continues to the carried destination', async () => {
    mount({ canEditLevel: true }, '/matches/e1');
    await pickSide();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.submit) }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/matches/e1'));
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
