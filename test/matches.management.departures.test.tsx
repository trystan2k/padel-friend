/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
const mocks = vi.hoisted(() => ({
  withdraw: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submit: vi.fn<() => void>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/matches/match-management.functions', () => ({
  withdrawMatchRegistration: mocks.withdraw,
  removeMatchRegistration: mocks.remove
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: mocks.invalidate }) }));
vi.mock('../src/features/matches/use-match-registration', () => ({
  useMatchRegistration: () => ({
    pending: false,
    online: true,
    cutoffReached: false,
    feedback: null,
    submit: mocks.submit
  })
}));
import { MatchParticipantActions } from '../src/features/matches/MatchParticipantActions';
import {
  MatchRegistrationPanel,
  type MatchRegistrationEvent
} from '../src/features/matches/MatchRegistrationPanel';
const id = '11111111-1111-4111-8111-111111111111';
function panel(locale: 'en' | 'pt-BR' | 'es', target = false) {
  const i18n = createI18n(locale);
  render(
    <I18nextProvider i18n={i18n}>
      <MatchParticipantActions
        eventId={id}
        attemptId={id}
        {...(target ? { targetUserId: id, name: 'Player' } : {})}
      />
    </I18nextProvider>
  );
  return i18n;
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
describe('management departure controls', () => {
  it('cancels self-withdrawal without submitting and restores the trigger and single status', async () => {
    const i18n = panel('en');
    const trigger = screen.getByRole('button', { name: i18n.t('matches.management.leave') });
    await userEvent.click(trigger);
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('matches.management.cancel') })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });
  it('shows own departure reason and ordinary re-entry CTA without exposing player IDs', async () => {
    const event: MatchRegistrationEvent = {
      event_id: id,
      registration_cutoff_at: '2030-01-01T00:00:00Z',
      starts_at: '2030-01-02T00:00:00Z',
      timezone: 'UTC',
      accepted_count: 1,
      playing_count: 0,
      reserve_count: 1,
      reserve_not_playing_count: 0,
      group_count: 0,
      more_needed: 3,
      maximum_registrations: null,
      is_past: false,
      caller_eligibility: 'member',
      caller_requires_approval: false,
      caller_is_invited: false,
      restriction_enabled: false,
      min_level: null,
      max_level: null,
      visibility: 'community_open'
    };
    const i18n = createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <MatchRegistrationPanel
          event={event}
          registration={{
            state: 'removed_by_creator',
            event_id: id,
            attempt_id: id,
            accepted_order: 2,
            accepted_at: '2029-01-01T00:00:00Z',
            left_at: null,
            removal_reason: 'Cannot attend',
            registration_source: 'member'
          }}
        />
      </I18nextProvider>
    );
    expect(screen.getByText('The organizer removed you from this match.')).toBeTruthy();
    expect(screen.getByText('Reason: Cannot attend')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Register again at the back of the queue' })
    );
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(id);
  });
  it('announces translated self-withdrawal and refreshes authoritative state', async () => {
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const i18n = panel(locale);
      mocks.withdraw.mockResolvedValue({ status: 'ok', value: {}, replayed: false });
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.management.leave') })
      );
      expect(screen.getByRole('status').textContent).toBe('');
      expect(mocks.withdraw).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole('button', { name: i18n.t('matches.management.confirm') })
      );
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(
          i18n.t('matches.management.withdrawnFeedback')
        )
      );
      expect(mocks.withdraw).toHaveBeenLastCalledWith({
        data: { event_id: id, attempt_id: id, request_id: expect.any(String) }
      });
      cleanup();
      mocks.withdraw.mockClear();
    }
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });
  it('retains request ID on uncertain transport retry and disables submitting', async () => {
    panel('en');
    let finish: (result: unknown) => void = () => undefined;
    mocks.withdraw.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const button = screen.getByRole('button', { name: 'Leave match' });
    await userEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mocks.withdraw).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', {
      name: createI18n('en').t('matches.management.confirm')
    });
    await userEvent.click(confirm);
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.click(confirm);
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    finish({ status: 'error', code: 'unavailable' });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    expect(button.hasAttribute('disabled')).toBe(true);
    mocks.withdraw.mockResolvedValue({ status: 'ok', value: {}, replayed: true });
    await userEvent.click(confirm);
    expect(mocks.withdraw.mock.calls[0]).toEqual(mocks.withdraw.mock.calls[1]);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });
  it('requires removal reason, opens accessible dialog from menu, restores focus on cancel', async () => {
    panel('en', true);
    const trigger = screen.getByRole('button', { name: 'Actions for Player' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove player' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Player?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Remove player' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('textbox', { name: 'Removal reason (required, up to 500 characters)' })
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('sends trimmed reason and announces success without rendering raw SQL', async () => {
    panel('en', true);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Player' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove player' }));
    await screen.findByRole('dialog');
    await userEvent.type(screen.getByRole('textbox'), ' Cannot attend ');
    mocks.remove.mockResolvedValue({ status: 'ok', value: {}, replayed: false });
    await userEvent.click(screen.getByRole('button', { name: 'Remove player' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.remove).toHaveBeenCalledWith({
      data: {
        event_id: id,
        attempt_id: id,
        target_user_id: id,
        reason: 'Cannot attend',
        request_id: expect.any(String)
      }
    });
    expect(screen.getByRole('status').textContent).toContain('Player removed.');
  });
});
