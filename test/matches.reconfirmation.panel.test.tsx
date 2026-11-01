/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import { makeMatchDetail } from './helpers/match-fixtures';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';
import type { MatchConsentChange } from '../src/features/matches/match-consent-change';
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
            is_provisional: false,
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
      expect(screen.getByText(i18n.t('matchRegistration.roster.awaitingStatus'))).toBeTruthy();
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
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'I confirm participation under these terms' })
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reload details' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
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

const change: MatchConsentChange = {
  generation: 2,
  changed_fields: ['league_id'],
  from: {
    competition_status: 'unranked',
    league_id: null,
    league_name: null,
    league_start_at: null,
    league_end_at: null,
    league_timezone: null
  },
  to: {
    competition_status: 'ranked',
    league_id: '44444444-4444-4444-8444-444444444444',
    league_name: 'Spring League',
    league_start_at: '2099-01-01T00:00:00.000Z',
    league_end_at: '2099-03-01T00:00:00.000Z',
    league_timezone: 'UTC'
  }
};
const participant = (overrides: Record<string, unknown>) => ({
  registration_id: id,
  user_id: id,
  attempt_id: id,
  display_name: 'Player',
  display_level: null,
  is_provisional: false,
  lifecycle: 'accepted' as const,
  participation: null,
  accepted_order: 1,
  required_generation: 2,
  confirmed_generation: 1,
  ...overrides
});

describe('Ranked/League consent summary', () => {
  const event = makeMatchDetail({
    event_id: id,
    starts_at: '2099-01-03T00:00:00Z',
    registration_cutoff_at: registration.registration_cutoff_at,
    reconfirmation_generation: 2
  });
  it.each(['en', 'pt-BR', 'es'] as const)(
    'the reconfirming player reviews old/new Ranked status, League name and window: %s',
    async (locale) => {
      const i18n = createI18n(locale);
      render(
        <I18nextProvider i18n={i18n}>
          <MatchReconfirmationPanel event={event} registration={{ ...registration, change }} />
        </I18nextProvider>
      );
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.reconfirmation.reviewTerms') })
      );
      const impact = await screen.findByRole('region', {
        name: i18n.t('matches.leagueImpact.title')
      });
      expect(impact.textContent).toContain(i18n.t('matches.competition.unranked'));
      expect(impact.textContent).toContain(
        `${i18n.t('matches.competition.ranked')} · Spring League`
      );
      expect(impact.textContent).toContain(i18n.t('matches.leagueImpact.effect.unrankedToRanked'));
      expect(impact.textContent).toContain(i18n.t('matches.leagueImpact.skillIndependent'));
      // League window uses League-local calendar days.
      expect(impact.textContent).toMatch(/2099/);
    }
  );
  it('shows no impact summary when the evidence predates League facts', async () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchReconfirmationPanel event={event} registration={registration} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review changed terms' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('region', { name: 'Ranking impact' })).toBeNull();
  });
  it('the organizer summary shows the same impact and lists only players who must act', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchReconfirmationPanel
          event={event}
          registration={null}
          isCreator
          change={change}
          participants={[
            participant({ display_name: 'Registered Rita' }),
            // Provisional players carry over automatically: equal generations, never listed.
            participant({
              display_name: 'Provisional Pat',
              is_provisional: true,
              confirmed_generation: 2,
              participation: 'playing',
              accepted_order: 2
            })
          ]}
        />
      </I18nextProvider>
    );
    expect(screen.getByText('1 player must reconfirm.')).toBeTruthy();
    expect(screen.getByText(/Registered Rita/)).toBeTruthy();
    expect(screen.queryByText(/Provisional Pat/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Ranking impact' }).textContent).toContain(
      'Ranked · Spring League'
    );
  });
});
