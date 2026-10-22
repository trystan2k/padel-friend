/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import { makeMatchDetail } from './helpers/match-fixtures';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';
const mocks = vi.hoisted(() => ({
  confirm: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/matches/match-reconfirmation.functions', () => ({
  reconfirmMatchRegistration: mocks.confirm
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
import { MatchReconfirmationPanel } from '../src/features/matches/MatchReconfirmationPanel';
const id = '11111111-1111-4111-8111-111111111111';
const registration: Extract<MyMatchRegistration, { state: 'reconfirmation_required' }> = {
  state: 'reconfirmation_required',
  event_id: id,
  attempt_id: id,
  accepted_order: 1,
  accepted_at: '2099-01-01T00:00:00Z',
  registration_source: 'creator',
  required_generation: 2,
  confirmed_generation: 1,
  registration_cutoff_at: '2099-01-02T00:00:00Z'
};
function element(locale: Locale = 'en', generation = 2) {
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchReconfirmationPanel
        key={generation}
        event={makeMatchDetail({
          event_id: id,
          starts_at: '2099-01-03T00:00:00Z',
          registration_cutoff_at: registration.registration_cutoff_at,
          reconfirmation_generation: generation
        })}
        registration={{ ...registration, required_generation: generation }}
        isCreator
        participants={[
          {
            registration_id: id,
            user_id: id,
            attempt_id: id,
            display_name: 'Player',
            display_level: null,
            lifecycle: 'accepted',
            participation: null,
            accepted_order: 1,
            required_generation: generation,
            confirmed_generation: 1
          }
        ]}
      />
    </I18nextProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('reconfirmation panel', () => {
  it.each(['en', 'pt-BR', 'es'] as const)(
    'player and creator see translated requirement and explicit consent: %s',
    async (locale) => {
      const i18n = createI18n(locale);
      render(element(locale));
      expect(
        screen.getByText(i18n.t('matches.reconfirmation.creatorSummary', { count: 1 }))
      ).toBeTruthy();
      expect(screen.getByText(/Player/)).toBeTruthy();
      expect(mocks.confirm).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.reconfirmation.reviewTerms') })
      );
      await screen.findByRole('dialog');
      mocks.confirm.mockResolvedValue({ status: 'ok', value: {}, replayed: false });
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.reconfirmation.confirm') })
      );
      await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
      expect(mocks.confirm).toHaveBeenCalledWith({
        data: expect.objectContaining({ generation: 2, attempt_id: id })
      });
    }
  );
  it('stale generation never silently retries', async () => {
    const view = render(element());
    mocks.confirm.mockResolvedValue({ status: 'error', code: 'stale_generation' });
    await userEvent.click(screen.getByRole('button', { name: 'Review changed terms' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'I confirm participation under these terms' })
    );
    await screen.findByText(
      'Match terms changed again. Reload and review the latest terms before confirming.'
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'I confirm participation under these terms' })
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest details' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
    view.rerender(element('en', 3));
    await userEvent.click(screen.getByRole('button', { name: 'Review changed terms' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'I confirm participation under these terms' })
    );
    expect(mocks.confirm).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ generation: 3 })
    });
  });
});
